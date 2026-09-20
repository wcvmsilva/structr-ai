/** Generic lifecycle writes through the real helpers, with a transactional storage fake.
 * This proves application boundaries and rollback behavior, not PostgreSQL scheduling/RLS.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as s from "../drizzle/schema";
const mocks = vi.hoisted(() => ({ getDb: vi.fn(), access: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./project-access", () => ({ requireProjectAccess: mocks.access }));
import {
  updateEstimateDraftStatus,
  updateEstimateDraftNotes,
  applyEstimateDraftDiscount,
  rejectEstimateDraft,
  archiveEstimateDraft,
  assertEstimateMutable,
} from "./estimate-db";

type Row = Record<string, any>;
type Table = Parameters<typeof getTableName>[0];
const id = (n: number) =>
  `c8200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const DRAFT = id(1),
  PROJECT = id(2),
  TENANT = id(3),
  USER = id(4),
  OTHER = id(5);
const at = new Date("2026-09-20T12:00:00.123Z");
const dialect = new PgDialect();
let data: Map<Table, Row[]>, trace: string[], db: any, tx: any;
let auditFailure: "throw" | "missing" | "transient" | null;
let transactionFailures: string[];
const rows = (table: Table) => data.get(table) ?? [];
const put = (table: Table, ...values: Row[]) => data.set(table, values);
const compiledPredicates = new WeakMap<SQL, Array<[string, unknown]>>();
function matches(table: Table, where: SQL | undefined, row: Row) {
  if (!where) return true;
  let conditions = compiledPredicates.get(where);
  if (!conditions) {
    const query = dialect.sqlToQuery(where);
    const lookup = Object.fromEntries(
      Object.entries(getTableColumns(table)).map(([key, column]) => [
        column.name,
        key,
      ])
    );
    conditions = [...query.sql.matchAll(/"[^\"]+"\."([^\"]+)" = \$(\d+)/g)].map(
      (match): [string, unknown] => [
        lookup[match[1]],
        query.params[Number(match[2]) - 1],
      ]
    );
    if (conditions.length === 0)
      throw new Error("Expected relational equality predicate");
    compiledPredicates.set(where, conditions);
  }
  return conditions.every(([field, value]) => row[field] === value);
}
function select(selection?: Record<string, any>) {
  let table: Table,
    where: SQL | undefined,
    limit: number | undefined,
    lock: string | undefined;
  const q: any = {
    from: (t: Table) => ((table = t), q),
    where: (w: SQL) => ((where = w), q),
    limit: (n: number) => ((limit = n), q),
    orderBy: () => q,
    for: (l: string) => ((lock = l), q),
    then: (resolve: any, reject: any) =>
      Promise.resolve()
        .then(() => {
          trace.push(`read:${getTableName(table)}:${lock ?? "none"}`);
          let found = rows(table).filter(r => matches(table, where, r));
          if (limit !== undefined) found = found.slice(0, limit);
          if (selection)
            found = found.map(row =>
              Object.fromEntries(
                Object.entries(selection).map(([key, col]) => [
                  key,
                  row[
                    Object.entries(getTableColumns(table)).find(
                      ([, v]) => v === col
                    )?.[0] ?? key
                  ],
                ])
              )
            );
          return structuredClone(found);
        })
        .then(resolve, reject),
  };
  return q;
}
function update(table: Table) {
  return {
    set: (values: Row) => {
      let where: SQL | undefined;
      const run = async () => {
        trace.push(`update:${getTableName(table)}`);
        const changed: Row[] = [];
        put(
          table,
          ...rows(table).map(r => {
            if (!matches(table, where, r)) return r;
            const next = { ...r, ...values };
            changed.push(next);
            return next;
          })
        );
        return structuredClone(changed);
      };
      const q: any = {
        where: (w: SQL) => ((where = w), q),
        returning: run,
        then: (yes: any, no: any) => run().then(yes, no),
      };
      return q;
    },
  };
}
function insert(table: Table) {
  return {
    values: (value: Row) => {
      const run = async () => {
        trace.push(`insert:${getTableName(table)}`);
        if (table === s.auditLogs && auditFailure === "throw")
          throw new Error("Synthetic durable audit unavailable");
        if (table === s.auditLogs && auditFailure === "transient")
          throw Object.assign(
            new Error("Synthetic audit serialization failure"),
            { code: "40001" }
          );
        if (table === s.auditLogs && auditFailure === "missing") return [];
        const added = {
          id: id(100 + rows(table).length),
          createdAt: at,
          ...value,
        };
        put(table, ...rows(table), added);
        return [structuredClone(added)];
      };
      return {
        returning: run,
        then: (yes: any, no: any) => run().then(yes, no),
      };
    },
  };
}
const operations = [
  [
    "status",
    "approve",
    (tenant = TENANT) =>
      updateEstimateDraftStatus(DRAFT, "archived", USER, tenant),
  ],
  [
    "notes",
    "write",
    (tenant = TENANT) =>
      updateEstimateDraftNotes(DRAFT, "New operational note", USER, tenant),
  ],
  [
    "discount",
    "approve",
    (tenant = TENANT) => applyEstimateDraftDiscount(DRAFT, 10, USER, tenant),
  ],
  [
    "reject",
    "approve",
    (tenant = TENANT) =>
      rejectEstimateDraft(DRAFT, USER, "Synthetic reason", tenant),
  ],
  [
    "archive",
    "delete",
    (tenant = TENANT) => archiveEstimateDraft(DRAFT, USER, tenant),
  ],
] as const;
const nonNotes = operations.filter(([name]) => name !== "notes");
function noWrites() {
  expect(trace.filter(t => /^(update|insert):/.test(t))).toEqual([]);
}
beforeEach(() => {
  vi.clearAllMocks();
  data = new Map();
  trace = [];
  auditFailure = null;
  transactionFailures = [];
  put(s.estimateDrafts, {
    id: DRAFT,
    projectId: PROJECT,
    tenantId: TENANT,
    clientId: null,
    createdBy: USER,
    status: "draft",
    source: "assembly_calculator",
    version: 1,
    lockedAt: null,
    supersededBy: null,
    supersedesId: null,
    changeOrderOf: null,
    subtotalPrice: "100.00",
    subtotalCost: "40.00",
    finalTotalPrice: "100.00",
    discountAmount: "0.00",
    discountApplied: false,
    notes: "Original reviewed note",
    lineItems: [{ costItemName: "Synthetic item", quantity: 2 }],
    metadata: { fixture: true },
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
  });
  put(s.projects, {
    id: PROJECT,
    tenantId: TENANT,
    clientId: null,
    deletedAt: null,
  });
  put(s.tenants, { id: TENANT, isActive: true });
  put(s.profiles, { id: USER, tenantId: TENANT, isActive: true });
  tx = { select, update, insert };
  db = {
    select,
    update,
    insert,
    transaction: vi.fn(async (fn: any, opts: any) => {
      trace.push(`transaction:${opts?.isolationLevel}`);
      const before = new Map(
        [...data].map(([t, r]) => [t, structuredClone(r)])
      );
      try {
        const result = await fn(tx);
        const failure = transactionFailures.shift();
        if (failure)
          throw Object.assign(
            new Error("Synthetic commit serialization failure"),
            { code: failure }
          );
        trace.push("commit");
        return result;
      } catch (error) {
        data = before;
        trace.push("rollback");
        throw error;
      }
    }),
  };
  mocks.getDb.mockResolvedValue(db);
  mocks.access.mockImplementation(async () => {
    trace.push("authorize");
    return { projectId: PROJECT, tenantId: TENANT };
  });
});

describe("generic estimate lifecycle with current context", () => {
  it.each(operations)(
    "%s reauthorizes on the locked transaction and audits atomically without requiring a client",
    async (_name, permission, run) => {
      const saved = await run();
      expect(saved.id).toBe(DRAFT);
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(trace[0]).toBe("transaction:serializable");
      expect(mocks.access).toHaveBeenCalledWith(PROJECT, USER, permission, {
        mode: "a1",
        transaction: tx,
        expectedTenantId: TENANT,
      });
      expect(trace.indexOf("read:projects:update")).toBeLessThan(
        trace.indexOf("read:estimate_drafts:update")
      );
      expect(trace).toContain("read:tenants:share");
      expect(trace).toContain("read:profiles:share");
      expect(trace.indexOf("authorize")).toBeLessThan(
        trace.indexOf("update:estimate_drafts")
      );
      expect(trace.indexOf("insert:audit_logs")).toBeLessThan(
        trace.indexOf("commit")
      );
      expect(trace.filter(t => t.startsWith("read:clients"))).toEqual([]);
      expect(rows(s.auditLogs)).toHaveLength(1);
    }
  );
  it.each(operations)(
    "%s rejects an absent trusted tenant",
    async (_name, _permission, run) => {
      await expect(run(null as never)).rejects.toMatchObject({
        code: "ESTIMATE_CONTEXT_UNRESOLVED",
      });
      noWrites();
    }
  );
  it.each(operations)(
    "%s rejects a current permission denial with no write/audit",
    async (_name, _permission, run) => {
      const denied = Object.assign(new Error("Current access denied"), {
        code: "FORBIDDEN",
      });
      mocks.access.mockRejectedValue(denied);
      await expect(run()).rejects.toBe(denied);
      noWrites();
    }
  );
  it.each([
    ["foreign project", s.projects, { tenantId: OTHER }],
    ["deleted project", s.projects, { deletedAt: at }],
    ["foreign draft", s.estimateDrafts, { tenantId: OTHER }],
    ["foreign actor", s.profiles, { tenantId: OTHER }],
    ["inactive actor", s.profiles, { isActive: false }],
    ["inactive tenant", s.tenants, { isActive: false }],
  ] as const)(
    "rejects %s before editing notes",
    async (_label, table, patch) => {
      Object.assign(rows(table)[0], patch);
      await expect(
        updateEstimateDraftNotes(DRAFT, "note", USER, TENANT)
      ).rejects.toBeDefined();
      noWrites();
    }
  );
  it("keeps the existing discount arithmetic and does not rewrite cost/lines/metadata", async () => {
    const before = structuredClone(rows(s.estimateDrafts)[0]);
    await applyEstimateDraftDiscount(DRAFT, 10, USER, TENANT);
    expect(rows(s.estimateDrafts)[0]).toEqual({
      ...before,
      discountApplied: true,
      discountAmount: "10.00",
      finalTotalPrice: "90.00",
    });
    expect(rows(s.auditLogs)[0]).toMatchObject({
      action: "estimate_draft.apply_discount",
      oldValues: {
        discountApplied: false,
        discountAmount: "0.00",
        finalTotalPrice: "100.00",
      },
    });
  });
  for (const fault of ["throw", "missing", "transient"] as const)
    it.each(operations)(
      `%s rolls back when audit is ${fault}`,
      async (_name, _permission, run) => {
        const before = structuredClone(rows(s.estimateDrafts));
        auditFailure = fault;
        await expect(run()).rejects.toMatchObject({
          name: "InternalApprovalAuditFailure",
        });
        expect(rows(s.estimateDrafts)).toEqual(before);
        expect(db.transaction).toHaveBeenCalledTimes(1);
        expect(rows(s.auditLogs)).toEqual([]);
        expect(trace).toContain("rollback");
        expect(trace).not.toContain("commit");
      }
    );
  it("retries the whole mutation on serialization/deadlock and commits only one audit", async () => {
    transactionFailures = ["40001", "40P01"];
    const saved = await updateEstimateDraftNotes(
      DRAFT,
      "Retry note",
      USER,
      TENANT
    );
    expect(saved.notes).toBe("Retry note");
    expect(db.transaction).toHaveBeenCalledTimes(3);
    expect(mocks.access).toHaveBeenCalledTimes(3);
    expect(rows(s.auditLogs)).toHaveLength(1);
    expect(trace.filter(t => t === "rollback")).toHaveLength(2);
  });
  it("stops after three serialization failures with no committed mutation or audit", async () => {
    transactionFailures = ["40001", "40001", "40001"];
    const before = structuredClone(rows(s.estimateDrafts));
    await expect(
      updateEstimateDraftNotes(DRAFT, "Retry note", USER, TENANT)
    ).rejects.toMatchObject({ code: "40001" });
    expect(db.transaction).toHaveBeenCalledTimes(3);
    expect(rows(s.estimateDrafts)).toEqual(before);
    expect(rows(s.auditLogs)).toEqual([]);
  });
});

describe("decision and historical boundaries", () => {
  for (const table of [
    s.estimateInternalApprovalSnapshots,
    s.estimateInternalApprovals,
  ]) {
    it.each(nonNotes)(
      `%s denies a forged draft status with relational ${getTableName(table)}`,
      async (_name, _permission, run) => {
        put(table, { id: OTHER, estimateDraftId: DRAFT, tenantId: TENANT });
        await expect(run()).rejects.toMatchObject({
          code: "ESTIMATE_VERSION_LOCKED",
        });
        noWrites();
      }
    );
  }
  for (const status of ["internally_approved", "internal_approval_revoked"]) {
    it.each(nonNotes)(
      `%s denies ${status} even when evidence is missing`,
      async (_name, _permission, run) => {
        rows(s.estimateDrafts)[0].status = status;
        await expect(run()).rejects.toMatchObject({
          code: "ESTIMATE_VERSION_LOCKED",
        });
        noWrites();
      }
    );
    it(`preserves operational notes and reviewed content on ${status}`, async () => {
      rows(s.estimateDrafts)[0].status = status;
      put(s.estimateInternalApprovalSnapshots, {
        id: OTHER,
        estimateDraftId: DRAFT,
        snapshotPayload: {
          presentation: { reviewedNotes: "Original reviewed note" },
        },
      });
      const snapshot = structuredClone(
        rows(s.estimateInternalApprovalSnapshots)
      );
      const before = structuredClone(rows(s.estimateDrafts)[0]);
      await updateEstimateDraftNotes(
        DRAFT,
        "New operational note",
        USER,
        TENANT
      );
      expect(rows(s.estimateDrafts)[0]).toEqual({
        ...before,
        notes: "New operational note",
      });
      expect(rows(s.estimateInternalApprovalSnapshots)).toEqual(snapshot);
      expect(rows(s.auditLogs)[0]).toMatchObject({
        action: "estimate_draft.update_notes",
        oldValues: { notes: "Original reviewed note" },
        newValues: { notes: "New operational note" },
      });
    });
  }
  it.each(["approved", "internally_approved", "internal_approval_revoked"])(
    "never assigns authority generically: %s",
    async status => {
      await expect(
        updateEstimateDraftStatus(DRAFT, status as never, USER, TENANT)
      ).rejects.toMatchObject({
        code: "ESTIMATE_APPROVAL_REQUIRES_DEDICATED_ACTION",
      });
      noWrites();
    }
  );
  it.each([
    "approved",
    "sent_to_estimate",
    "archived",
    "rejected",
    "converted",
  ])("discount refuses %s", async status => {
    rows(s.estimateDrafts)[0].status = status;
    await expect(
      applyEstimateDraftDiscount(DRAFT, 10, USER, TENANT)
    ).rejects.toMatchObject({ code: "ESTIMATE_VERSION_LOCKED" });
    noWrites();
  });
  it.each([{ lockedAt: at }, { supersededBy: OTHER }])(
    "discount refuses draft restriction %j",
    async patch => {
      Object.assign(rows(s.estimateDrafts)[0], patch);
      await expect(
        applyEstimateDraftDiscount(DRAFT, 10, USER, TENANT)
      ).rejects.toMatchObject({ code: "ESTIMATE_VERSION_LOCKED" });
      noWrites();
    }
  );
  for (const kind of ["source", "link"]) {
    it(`retains historical notes and visual archive by ${kind}`, async () => {
      if (kind === "source")
        rows(s.estimateDrafts)[0].source = "historical_import";
      else
        put(s.historicalEstimateImports, { id: OTHER, estimateDraftId: DRAFT });
      await updateEstimateDraftNotes(DRAFT, "Capture note", USER, TENANT);
      const saved = await archiveEstimateDraft(DRAFT, USER, TENANT);
      expect(saved).toMatchObject({
        status: "archived",
        notes: "Capture note",
        subtotalCost: "40.00",
        finalTotalPrice: "100.00",
      });
      expect(rows(s.auditLogs)).toHaveLength(2);
      await expect(
        updateEstimateDraftStatus(DRAFT, "draft", USER, TENANT)
      ).rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" });
    });
  }
  it.each(["internally_approved", "internal_approval_revoked"])(
    "pure mutability guard recognizes %s",
    status => {
      expect(() =>
        assertEstimateMutable({ id: DRAFT, status, version: 1 }, "edit")
      ).toThrow(expect.objectContaining({ code: "ESTIMATE_VERSION_LOCKED" }));
    }
  );
});

const financialActions = [
  [
    "status",
    () => updateEstimateDraftStatus(DRAFT, "sent_to_estimate", USER, TENANT),
  ],
  ["discount", () => applyEstimateDraftDiscount(DRAFT, 10, USER, TENANT)],
  ["reject", () => rejectEstimateDraft(DRAFT, USER, "Reason", TENANT)],
] as const;
describe("calculated eligibility and historical ancestry", () => {
  for (const source of [null, "bundle_legacy"]) {
    it(`discount refuses unproven ancestor source ${source}`, async () => {
      const current=rows(s.estimateDrafts)[0];
      rows(s.estimateDrafts).push({...structuredClone(current),id:id(6),source});
      Object.assign(current,{source:"version",supersedesId:id(6)});
      await expect(applyEstimateDraftDiscount(DRAFT,10,USER,TENANT)).rejects.toMatchObject({code:"ESTIMATE_CONTEXT_UNRESOLVED"});noWrites();
    });
    it.each(financialActions.filter(([action])=>action!=="discount"))(`%s retains ordinary legacy transition with ancestor source ${source}`, async (_name, run) => {
      const current=rows(s.estimateDrafts)[0];
      rows(s.estimateDrafts).push({...structuredClone(current),id:id(6),source});
      Object.assign(current,{source:"version",supersedesId:id(6)});
      await expect(run()).resolves.toMatchObject({id:DRAFT,finalTotalPrice:"100.00"});
      expect(rows(s.auditLogs)).toHaveLength(1);
    });
  }

  for (const source of ["version", "change_order"])
    for (const placement of ["current", "ancestor"]) {
      it.each(financialActions)(
        `%s refuses missing required derivation edge on ${placement} ${source}`,
        async (_name, run) => {
          const current = rows(s.estimateDrafts)[0];
          if (placement === "current") current.source = source;
          else {
            rows(s.estimateDrafts).push({
              ...structuredClone(current),
              id: id(6),
              source,
            });
            Object.assign(current, { source: "version", supersedesId: id(6) });
          }
          await expect(run()).rejects.toMatchObject({
            code: "ESTIMATE_CONTEXT_UNRESOLVED",
          });
          noWrites();
        }
      );
    }

  it.each([null, "unknown", "bundle"])(
    "discount refuses an unproven calculated source %s",
    async source => {
      rows(s.estimateDrafts)[0].source = source;
      await expect(
        applyEstimateDraftDiscount(DRAFT, 10, USER, TENANT)
      ).rejects.toMatchObject({ code: "ESTIMATE_CONTEXT_UNRESOLVED" });
      noWrites();
    }
  );
  for (const edge of ["supersedesId", "changeOrderOf"] as const) {
    it.each(financialActions)(
      `%s refuses an ancestor with durable H1 link through ${edge}`,
      async (_label, run) => {
        const ancestor = {
          ...structuredClone(rows(s.estimateDrafts)[0]),
          id: id(6),
          source: "assembly_calculator",
        };
        rows(s.estimateDrafts).push(ancestor);
        Object.assign(rows(s.estimateDrafts)[0], {
          [edge]: ancestor.id,
          source: edge === "supersedesId" ? "version" : "change_order",
        });
        put(s.historicalEstimateImports, {
          id: id(7),
          estimateDraftId: ancestor.id,
        });
        await expect(run()).rejects.toMatchObject({
          code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE",
        });
        noWrites();
      }
    );
    it(`discount retains exact prices and allows valid nullable-client lineage through ${edge}`, async () => {
      const ancestor = {
        ...structuredClone(rows(s.estimateDrafts)[0]),
        id: id(6),
        status: "approved",
      };
      rows(s.estimateDrafts).push(ancestor);
      Object.assign(rows(s.estimateDrafts)[0], {
        [edge]: ancestor.id,
        source: edge === "supersedesId" ? "version" : "change_order",
      });
      expect(
        await applyEstimateDraftDiscount(DRAFT, 10, USER, TENANT)
      ).toMatchObject({
        clientId: null,
        discountAmount: "10.00",
        finalTotalPrice: "90.00",
      });
      expect(rows(s.estimateDrafts)[1]).toEqual(ancestor);
    });
  }
  for (const invalid of [
    "missing",
    "cycle",
    "foreign tenant",
    "foreign project",
    "foreign client",
  ] as const) {
    it.each(financialActions)(
      `%s rejects ${invalid} in the ancestry before mutation`,
      async (_label, run) => {
        const current = rows(s.estimateDrafts)[0];
        Object.assign(current, { source: "version", supersedesId: id(6) });
        if (invalid !== "missing")
          rows(s.estimateDrafts).push({
            ...structuredClone(current),
            id: id(6),
            supersedesId: invalid === "cycle" ? DRAFT : null,
            ...(invalid === "foreign tenant" ? { tenantId: OTHER } : {}),
            ...(invalid === "foreign project" ? { projectId: OTHER } : {}),
            ...(invalid === "foreign client" ? { clientId: OTHER } : {}),
          });
        await expect(run()).rejects.toMatchObject({
          code: "ESTIMATE_CONTEXT_UNRESOLVED",
        });
        noWrites();
      }
    );
  }
  it("recognizes a shared ancestor through both edges without treating it as a cycle", async () => {
    const ancestor = {
      ...structuredClone(rows(s.estimateDrafts)[0]),
      id: id(6),
    };
    rows(s.estimateDrafts).push(ancestor);
    Object.assign(rows(s.estimateDrafts)[0], {
      source: "version",
      supersedesId: ancestor.id,
      changeOrderOf: ancestor.id,
    });
    expect(
      await applyEstimateDraftDiscount(DRAFT, 10, USER, TENANT)
    ).toMatchObject({ finalTotalPrice: "90.00" });
  });
  it("accepts a complete lineage of exactly 1000 records", async () => {
    const template = structuredClone(rows(s.estimateDrafts)[0]);
    for (let n = 0; n < 999; n++)
      rows(s.estimateDrafts).push({
        ...template,
        id: id(10000 + n),
        source: n === 998 ? "assembly_calculator" : "version",
        supersedesId: n === 998 ? null : id(10001 + n),
      });
    Object.assign(rows(s.estimateDrafts)[0], {
      source: "version",
      supersedesId: id(10000),
    });
    expect(
      await applyEstimateDraftDiscount(DRAFT, 10, USER, TENANT)
    ).toMatchObject({ finalTotalPrice: "90.00" });
    expect(rows(s.auditLogs)).toHaveLength(1);
  });
  it("denies a lineage beyond the bounded 1000-record traversal", async () => {
    const template = structuredClone(rows(s.estimateDrafts)[0]);
    for (let n = 0; n < 1000; n++)
      rows(s.estimateDrafts).push({
        ...template,
        id: id(10000 + n),
        source: n === 999 ? "assembly_calculator" : "version",
        supersedesId: n === 999 ? null : id(10001 + n),
      });
    Object.assign(rows(s.estimateDrafts)[0], {
      source: "version",
      supersedesId: id(10000),
    });
    await expect(
      applyEstimateDraftDiscount(DRAFT, 10, USER, TENANT)
    ).rejects.toMatchObject({ code: "ESTIMATE_CONTEXT_UNRESOLVED" });
    noWrites();
  });
});
