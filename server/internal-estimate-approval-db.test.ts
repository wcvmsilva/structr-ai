import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as s from "../drizzle/schema";
import {
  buildInternalApprovalReview,
  type ReviewResult,
} from "../shared/internal-estimate-approval-engine";
import {
  makeInternalApprovalReviewInput,
  approvalIds as ids,
} from "./internal-estimate-approval-engine.fixtures";
const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  access: vi.fn(),
  adapter: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./project-access", () => ({ requireProjectAccess: mocks.access }));
vi.mock("./internal-estimate-approval-adapter", () => ({
  buildInternalApprovalReviewFromRows: mocks.adapter,
}));
import {
  getInternalApprovalReview,
  recordInternalEstimateApproval,
  revokeInternalEstimateApproval,
  getInternalApproval,
} from "./internal-estimate-approval-db";

type Row = Record<string, any>;
type Table = Parameters<typeof getTableName>[0];
const uuid = (n: number) =>
  `b2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = new Date("2026-09-20T12:00:00.123Z");
const dialect = new PgDialect();
let data: Map<Table, Row[]>,
  trace: string[],
  db: any,
  tx: any,
  review: ReviewResult,
  seq: number,
  writeFailure: Table | undefined,
  auditFailure: unknown,
  commitFaults: unknown[];
const rows = (table: Table) => data.get(table) ?? [];
function put(table: Table, ...values: Row[]) {
  data.set(table, values);
}
function matches(table: Table, where: SQL | undefined, row: Row) {
  if (!where) return true;
  const { sql, params } = dialect.sqlToQuery(where),
    columns = getTableColumns(table),
    lookup = Object.fromEntries(
      Object.entries(columns).map(([key, value]) => [value.name, key])
    );
  for (const match of sql.matchAll(/"[^\"]+"\."([^\"]+)" = \$(\d+)/g))
    if (row[lookup[match[1]]] !== params[Number(match[2]) - 1]) return false;
  for (const match of sql.matchAll(/"[^\"]+"\."([^\"]+)" in \(([^)]+)\)/gi)) {
    const values = [...match[2].matchAll(/\$(\d+)/g)].map(
      x => params[Number(x[1]) - 1]
    );
    if (!values.includes(row[lookup[match[1]]])) return false;
  }
  return true;
}
function select(selection?: Record<string, any>) {
  let table: Table,
    where: SQL | undefined,
    limit: number | undefined,
    lock: string | undefined;
  const q: any = {
    from: (t: Table) => {
      table = t;
      return q;
    },
    where: (w: SQL) => {
      where = w;
      return q;
    },
    limit: (v: number) => {
      limit = v;
      return q;
    },
    orderBy: () => q,
    for: (v: string) => {
      lock = v;
      return q;
    },
    then: (resolve: any, reject: any) =>
      Promise.resolve()
        .then(() => {
          trace.push(`read:${getTableName(table)}:${lock ?? "none"}`);
          let result = rows(table).filter(r => matches(table, where, r));
          if (limit !== undefined) result = result.slice(0, limit);
          if (selection) {
            const cols = getTableColumns(table);
            result = result.map(row =>
              Object.fromEntries(
                Object.entries(selection).map(([key, column]) => [
                  key,
                  row[
                    Object.entries(cols).find(([, v]) => v === column)?.[0] ??
                      key
                  ],
                ])
              )
            );
          }
          return structuredClone(result);
        })
        .then(resolve, reject),
  };
  return q;
}
function insert(table: Table) {
  return {
    values: (value: Row | Row[]) => {
      const run = async () => {
        trace.push(`insert:${getTableName(table)}`);
        if (table === s.auditLogs && auditFailure) throw auditFailure;
        if (table === writeFailure)
          throw new Error("Synthetic storage failure");
        const added = (Array.isArray(value) ? value : [value]).map(v => ({
          id: uuid(seq++),
          createdAt: at,
          updatedAt: at,
          deletedAt: null,
          ...v,
        }));
        data.set(table, [...rows(table), ...structuredClone(added)]);
        return structuredClone(added);
      };
      return {
        returning: run,
        then: (resolve: any, reject: any) => run().then(resolve, reject),
      };
    },
  };
}
function update(table: Table) {
  return {
    set: (value: Row) => {
      let where: SQL | undefined;
      const run = async () => {
        trace.push(`update:${getTableName(table)}`);
        if (table === writeFailure)
          throw new Error("Synthetic storage failure");
        const changed: Row[] = [];
        data.set(
          table,
          rows(table).map(row => {
            if (!matches(table, where, row)) return row;
            const next = { ...row, ...value };
            changed.push(next);
            return next;
          })
        );
        return structuredClone(changed);
      };
      const q: any = {
        where: (w: SQL) => {
          where = w;
          return q;
        },
        returning: run,
        then: (resolve: any, reject: any) => run().then(resolve, reject),
      };
      return q;
    },
  };
}
function command() {
  return {
    id: ids.draft,
    requestId: ids.request,
    expectedDraftVersion: 1,
    expectedContentHash: review.contentHash,
    expectedPolicyHash: review.policyHash,
    confirmedCurrencyCode: "USD" as const,
    reason: "Synthetic human review",
  };
}
function revokeCommand(approvalId: string) {
  return {
    id: ids.draft,
    approvalId,
    requestId: uuid(90),
    expectedContentHash: review.contentHash,
    reason: "Synthetic human revocation",
  };
}
const approve = () =>
  recordInternalEstimateApproval(command(), ids.actor, ids.tenant);
async function saved() {
  return approve();
}
beforeEach(async () => {
  vi.clearAllMocks();
  data = new Map();
  trace = [];
  seq = 100;
  writeFailure = undefined;
  auditFailure = undefined;
  commitFaults = [];
  const input = makeInternalApprovalReviewInput();
  review = await buildInternalApprovalReview(input);
  put(s.estimateDrafts, {
    id: ids.draft,
    tenantId: ids.tenant,
    projectId: ids.project,
    clientId: ids.client,
    createdBy: ids.actor,
    status: "draft",
    source: "assembly_calculator",
    version: 1,
    supersedesId: null,
    changeOrderOf: null,
    supersededBy: null,
    approvedBy: null,
    approvedAt: null,
    lockedAt: null,
    createdAt: new Date(input.origin.sourceCreatedAt),
    updatedAt: at,
    notes: input.presentation.reviewedNotes,
    subtotalPrice: "100",
    subtotalCost: "40",
    finalTotalPrice: "100",
    discountAmount: "0",
    discountApplied: false,
    scopeDraftId: null,
  });
  put(s.projects, {
    id: ids.project,
    tenantId: ids.tenant,
    clientId: ids.client,
    ownerUserId: ids.actor,
    deletedAt: null,
    zoneModifierSnapshot: { zoneId: ids.zone },
  });
  put(s.tenants, { id: ids.tenant, isActive: true });
  put(s.profiles, {
    id: ids.actor,
    tenantId: ids.tenant,
    isActive: true,
    role: "user",
  });
  put(s.clients, {
    id: ids.client,
    tenantId: ids.tenant,
    isActive: true,
    deletedAt: null,
  });
  put(s.geoZones, { id: ids.zone, tenantId: ids.tenant, isActive: true });
  tx = {
    select: vi.fn(select),
    insert: vi.fn(insert),
    update: vi.fn(update),
    execute: vi.fn(async () => [{ matches: true }]),
  };
  db = {
    transaction: vi.fn(async (work: any, options: any) => {
      trace.push("begin:" + options?.isolationLevel);
      const before = new Map(
        [...data].map(([table, values]) => [table, structuredClone(values)])
      );
      try {
        const value = await work(tx);
        const fault = commitFaults.shift();
        if (fault) throw fault;
        trace.push("commit");
        return value;
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
    return {
      projectId: ids.project,
      tenantId: ids.tenant,
      via: "owner",
      permissions: ["read", "write", "approve"],
    };
  });
  mocks.adapter.mockImplementation(async () => {
    trace.push("adapt");
    return structuredClone(review);
  });
});

describe("A1 approval persistence and durable audit", () => {
  it.each([
    "00000000-0000-0000-0000-000000000001",
    "12345678-1234-f234-1234-123456789abc",
  ])("previews a Core canonical UUID without version or variant restrictions (%s)", async id => {
    rows(s.estimateDrafts)[0].id = id;
    const input = makeInternalApprovalReviewInput();
    input.identity.estimateDraftId = id;
    review = await buildInternalApprovalReview(input);
    expect(
      await getInternalApprovalReview(
        { id, confirmedCurrencyCode: "USD" }, ids.actor, ids.tenant
      )
    ).toEqual(review);
    expect(mocks.adapter).toHaveBeenCalledOnce();
  });
  it("rejects a nil preview UUID before reading storage", async () => {
    await expect(
      getInternalApprovalReview(
        { id: "00000000-0000-0000-0000-000000000000", confirmedCurrencyCode: "USD" },
        ids.actor, ids.tenant
      )
    ).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INPUT_INVALID" });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.adapter).not.toHaveBeenCalled();
  });
  it("rejects a noncanonical uppercase preview UUID before reading storage", async () => {
    await expect(
      getInternalApprovalReview(
        { id: ids.draft.toUpperCase(), confirmedCurrencyCode: "USD" },
        ids.actor,
        ids.tenant
      )
    ).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INPUT_INVALID" });
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.adapter).not.toHaveBeenCalled();
  });
  it("previews exact reviewed content inside SERIALIZABLE with current approve access and no writes", async () => {
    expect(
      await getInternalApprovalReview(
        { id: ids.draft, confirmedCurrencyCode: "USD" },
        ids.actor,
        ids.tenant
      )
    ).toEqual(review);
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "serializable",
    });
    expect(mocks.access).toHaveBeenCalledWith(
      ids.project,
      ids.actor,
      "approve",
      { mode: "a1", transaction: tx, expectedTenantId: ids.tenant }
    );
    expect(trace.filter(x => /^(insert|update):/.test(x))).toEqual([]);
    expect(trace.indexOf("read:projects:update")).toBeLessThan(
      trace.indexOf("read:estimate_drafts:update")
    );
    expect(trace.indexOf("authorize")).toBeLessThan(trace.indexOf("adapt"));
  });
  it("persists exactly one immutable decision with unchanged money and a durable audit on the same handle", async () => {
    const result = await approve();
    expect(result).toMatchObject({
      draftId: ids.draft,
      draftVersion: 1,
      state: "active",
      revocationId: null,
      replayed: false,
      contentHash: review.contentHash,
    });
    expect(rows(s.estimateInternalApprovalSnapshots)).toHaveLength(1);
    expect(rows(s.estimateInternalApprovals)).toHaveLength(1);
    expect(rows(s.auditLogs)).toHaveLength(1);
    expect(rows(s.auditLogs)[0]).toMatchObject({
      action: "estimate.internal_approved",
      recordId: ids.draft,
      userId: ids.actor,
      oldValues: expect.objectContaining({ status: "draft" }),
    });
    expect(rows(s.estimateDrafts)[0]).toMatchObject({
      status: "internally_approved",
      finalTotalPrice: "100",
      subtotalCost: "40",
      approvedBy: ids.actor,
    });
    expect(rows(s.estimateInternalApprovalSnapshots)[0]).toMatchObject({
      finalPriceMinor: "10000",
      estimatedCostMinor: "4000",
      capturedBy: ids.actor,
      snapshotPayload: review.snapshot,
    });
    expect(trace.indexOf("update:estimate_drafts")).toBeLessThan(
      trace.indexOf("insert:estimate_internal_approval_snapshots")
    );
    expect(
      [...data.keys()].filter(
        t => rows(t).length && getTableName(t).includes("field")
      )
    ).toEqual([]);
  });
  it("denies current access before adapting or writing", async () => {
    mocks.access.mockRejectedValue(new Error("Permission withdrawn"));
    await expect(approve()).rejects.toThrow("Permission withdrawn");
    expect(mocks.adapter).not.toHaveBeenCalled();
    expect(rows(s.auditLogs)).toEqual([]);
  });
  it.each(["tenant", "profile", "client", "project"] as const)(
    "denies inactive %s context for a decision",
    async target => {
      if (target === "project") rows(s.projects)[0].deletedAt = at;
      else
        rows(
          { tenant: s.tenants, profile: s.profiles, client: s.clients }[target]
        )[0].isActive = false;
      await expect(approve()).rejects.toThrow();
      expect(mocks.adapter).not.toHaveBeenCalled();
      expect(rows(s.estimateInternalApprovals)).toEqual([]);
    }
  );
  it("denies a project/client mismatch even when the access preflight would grant", async () => {
    rows(s.projects)[0].clientId = uuid(75);
    await expect(approve()).rejects.toThrow();
    expect(mocks.adapter).not.toHaveBeenCalled();
  });
  it("does not reveal or approve another tenant draft", async () => {
    rows(s.estimateDrafts)[0].tenantId = uuid(76);
    await expect(approve()).rejects.toThrow();
    expect(mocks.adapter).not.toHaveBeenCalled();
  });
  it.each(["source", "link", "ancestor"] as const)(
    "rejects historical %s evidence before adapting money",
    async kind => {
      if (kind === "source")
        rows(s.estimateDrafts)[0].source = "historical_import";
      if (kind === "link")
        put(s.historicalEstimateImports, {
          id: uuid(77),
          estimateDraftId: ids.draft,
          tenantId: ids.tenant,
        });
      if (kind === "ancestor") {
        rows(s.estimateDrafts)[0].supersedesId = uuid(78);
        rows(s.estimateDrafts).push({
          ...rows(s.estimateDrafts)[0],
          id: uuid(78),
          source: "historical_import",
          supersedesId: null,
        });
      }
      await expect(approve()).rejects.toMatchObject({
        code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE",
      });
      expect(mocks.adapter).not.toHaveBeenCalled();
    }
  );
  it("rejects a cycle across both lineage edges", async () => {
    rows(s.estimateDrafts)[0].changeOrderOf = uuid(79);
    rows(s.estimateDrafts).push({
      ...rows(s.estimateDrafts)[0],
      id: uuid(79),
      changeOrderOf: null,
      supersedesId: ids.draft,
    });
    await expect(approve()).rejects.toThrow();
    expect(mocks.adapter).not.toHaveBeenCalled();
  });
  it.each([
    "expectedDraftVersion",
    "expectedContentHash",
    "expectedPolicyHash",
  ] as const)("requires fresh %s from the actual review", async key => {
    await expect(
      recordInternalEstimateApproval(
        {
          ...command(),
          [key]: key === "expectedDraftVersion" ? 2 : "f".repeat(64),
        },
        ids.actor,
        ids.tenant
      )
    ).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_REVIEW_STALE" });
    expect(rows(s.estimateInternalApprovals)).toEqual([]);
  });
  it("never turns a known failing margin into approval", async () => {
    const input = makeInternalApprovalReviewInput();
    input.financials.estimatedCostMinor = "6000";
    input.lines[0].lineTotalCostMinor = "6000";
    input.lines[0].unitCostSnapshot = "30";
    input.assemblySelections[0].unitCost = "30";
    input.assemblySelections[0].extendedCostMinor = "6000";
    review = await buildInternalApprovalReview(input);
    rows(s.estimateDrafts)[0].subtotalCost = "60";
    await expect(approve()).rejects.toMatchObject({
      code: "PROFIT_SHIELD_CHANNEL_FLOOR",
    });
    expect(rows(s.auditLogs)).toEqual([]);
  });
  it.each(
    [
      s.estimateInternalApprovalSnapshots,
      s.estimateInternalApprovals,
      s.auditLogs,
    ].map(t => [getTableName(t), t] as const)
  )("rolls everything back after a %s insert failure", async (_name, table) => {
    writeFailure = table;
    await expect(approve()).rejects.toThrow("Synthetic storage failure");
    expect(rows(s.estimateDrafts)[0].status).toBe("draft");
    expect(rows(s.estimateInternalApprovalSnapshots)).toEqual([]);
    expect(rows(s.estimateInternalApprovals)).toEqual([]);
    expect(rows(s.auditLogs)).toEqual([]);
  });
  it("does not retry even a transient-looking exception originating in audit", async () => {
    auditFailure = Object.assign(new Error("Synthetic audit failed"), {
      code: "40001",
    });
    await expect(approve()).rejects.toThrow("Synthetic audit failed");
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
  it("never retries an audit failure hidden inside a transient-looking transaction wrapper", async () => {
    auditFailure = new Error("Synthetic wrapped audit failed");
    const transaction = db.transaction.getMockImplementation();
    db.transaction.mockImplementation(async (...args: any[]) => {
      try {
        return await transaction(...args);
      } catch (cause) {
        throw Object.assign(new Error("Synthetic outer transaction failure"), {
          code: "40001",
          cause,
        });
      }
    });
    await expect(approve()).rejects.toThrow(
      "Synthetic outer transaction failure"
    );
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(rows(s.estimateInternalApprovals)).toEqual([]);
  });
  it.each(["cyclic", "truncated"])(
    "does not retry an ambiguous %s error chain",
    async kind => {
      const failure: { code: string; cause?: unknown } = { code: "40001" };
      if (kind === "cyclic") failure.cause = failure;
      else {
        let cursor: { cause?: unknown } = failure;
        for (let i = 0; i < 6; i++) {
          const next: { cause?: unknown } = {};
          cursor.cause = next;
          cursor = next;
        }
      }
      commitFaults = [failure, failure, failure];
      await expect(approve()).rejects.toBe(failure);
      expect(db.transaction).toHaveBeenCalledTimes(1);
      expect(rows(s.auditLogs)).toEqual([]);
    }
  );
  it.each(["40001", "40P01"])(
    "retries a complete transaction after %s and commits one decision",
    async code => {
      commitFaults = [{ code }];
      const result = await approve();
      expect(db.transaction).toHaveBeenCalledTimes(2);
      expect(rows(s.auditLogs)).toHaveLength(1);
      expect(rows(s.estimateInternalApprovals)).toHaveLength(1);
      expect(rows(s.estimateInternalApprovals)[0].requestId).toBe(ids.request);
      expect(result.replayed).toBe(false);
    }
  );
  it("stops serialization retries after exactly three attempts", async () => {
    commitFaults = [{ code: "40001" }, { code: "40001" }, { code: "40001" }];
    await expect(approve()).rejects.toMatchObject({ code: "40001" });
    expect(db.transaction).toHaveBeenCalledTimes(3);
    expect(rows(s.auditLogs)).toEqual([]);
  });
  it("does not retry unrelated storage failures", async () => {
    commitFaults = [{ code: "08006" }];
    await expect(approve()).rejects.toMatchObject({ code: "08006" });
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
  it("replays the same request without re-adapting live policy or duplicating audit", async () => {
    const first = await saved();
    mocks.adapter.mockRejectedValue(new Error("Context now unresolved"));
    const result = await approve();
    expect(result).toMatchObject({ ...first, replayed: true });
    expect(rows(s.auditLogs)).toHaveLength(1);
    expect(mocks.access).toHaveBeenCalledTimes(2);
  });
  it("rejects changed content under the same request key", async () => {
    await saved();
    await expect(
      recordInternalEstimateApproval(
        { ...command(), reason: "Changed human explanation" },
        ids.actor,
        ids.tenant
      )
    ).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_REQUEST_CONFLICT" });
    expect(rows(s.auditLogs)).toHaveLength(1);
  });
  it("rejects a new key on an already decided draft", async () => {
    await saved();
    await expect(
      recordInternalEstimateApproval(
        { ...command(), requestId: uuid(81) },
        ids.actor,
        ids.tenant
      )
    ).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_ALREADY_DECIDED" });
  });
  it("rechecks permission before returning a replay", async () => {
    await saved();
    mocks.access.mockRejectedValue(new Error("Permission withdrawn"));
    await expect(approve()).rejects.toThrow("Permission withdrawn");
    expect(rows(s.auditLogs)).toHaveLength(1);
  });
  it("revokes only the exact decision and preserves original approved evidence", async () => {
    const first = await saved();
    const result = await revokeInternalEstimateApproval(
      revokeCommand(first.approvalId),
      ids.actor,
      ids.tenant
    );
    expect(result).toMatchObject({
      draftId: ids.draft,
      approvalId: first.approvalId,
      replayed: false,
      contentHash: review.contentHash,
    });
    expect(rows(s.estimateDrafts)[0]).toMatchObject({
      status: "internal_approval_revoked",
      approvedBy: ids.actor,
      finalTotalPrice: "100",
    });
    expect(rows(s.estimateInternalApprovalRevocations)).toHaveLength(1);
    expect(rows(s.auditLogs).map(x => x.action)).toEqual([
      "estimate.internal_approved",
      "estimate.internal_approval_revoked",
    ]);
  });
  it("replays approval after revocation as revoked without reactivation", async () => {
    const first = await saved();
    const revoked = await revokeInternalEstimateApproval(
      revokeCommand(first.approvalId),
      ids.actor,
      ids.tenant
    );
    expect(await approve()).toMatchObject({
      approvalId: first.approvalId,
      state: "revoked",
      revocationId: revoked.revocationId,
      replayed: true,
    });
    expect(rows(s.auditLogs)).toHaveLength(2);
  });
  it("replays revocation without a second event or audit", async () => {
    const first = await saved();
    const cmd = revokeCommand(first.approvalId);
    const revoked = await revokeInternalEstimateApproval(
      cmd,
      ids.actor,
      ids.tenant
    );
    expect(
      await revokeInternalEstimateApproval(cmd, ids.actor, ids.tenant)
    ).toMatchObject({ ...revoked, replayed: true });
    expect(rows(s.estimateInternalApprovalRevocations)).toHaveLength(1);
    expect(rows(s.auditLogs)).toHaveLength(2);
  });
  it("rejects an incorrect approval ID during revoke without writes", async () => {
    await saved();
    await expect(
      revokeInternalEstimateApproval(
        revokeCommand(uuid(82)),
        ids.actor,
        ids.tenant
      )
    ).rejects.toThrow();
    expect(rows(s.estimateInternalApprovalRevocations)).toEqual([]);
  });
  it("rolls revoke projection and event back when audit fails", async () => {
    const first = await saved();
    auditFailure = new Error("Synthetic audit failed");
    await expect(
      revokeInternalEstimateApproval(
        revokeCommand(first.approvalId),
        ids.actor,
        ids.tenant
      )
    ).rejects.toThrow();
    expect(rows(s.estimateDrafts)[0].status).toBe("internally_approved");
    expect(rows(s.estimateInternalApprovalRevocations)).toEqual([]);
  });
  it("returns explicit none without constructing approved content from a legacy status", async () => {
    rows(s.estimateDrafts)[0].status = "approved";
    expect(await getInternalApproval(ids.draft, ids.actor, ids.tenant)).toEqual(
      { state: "none", approval: null, snapshot: null, revocation: null }
    );
    expect(mocks.adapter).not.toHaveBeenCalled();
  });
  it("reads strict evidence with exact string money and supports inactive-client history", async () => {
    await saved();
    rows(s.clients)[0].isActive = false;
    rows(s.estimateInternalApprovalSnapshots)[0].unexpectedPrivate =
      "do not expose";
    const result = await getInternalApproval(ids.draft, ids.actor, ids.tenant);
    expect(result.state).toBe("active");
    expect(result.snapshot).toMatchObject({
      finalPriceMinor: "10000",
      snapshotPayload: review.snapshot,
      deletedAt: null,
    });
    expect(result.snapshot).not.toHaveProperty("unexpectedPrivate");
    if (result.state === "none") throw new Error("Expected decision");
    expect(typeof result.approval.approvedAt).toBe("string");
    expect(mocks.access).toHaveBeenLastCalledWith(
      ids.project,
      ids.actor,
      "read",
      { mode: "a1", transaction: tx, expectedTenantId: ids.tenant }
    );
  });
  it("denies evidence reads for an inactive tenant even if the profile and client remain active", async () => {
    await saved();
    rows(s.tenants)[0].isActive = false;
    await expect(
      getInternalApproval(ids.draft, ids.actor, ids.tenant)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("refuses a noncanonical uppercase UUID in the persisted approval DTO", async () => {
    await saved();
    const approval = rows(s.estimateInternalApprovals)[0];
    approval.id = approval.id.toUpperCase();
    await expect(
      getInternalApproval(ids.draft, ids.actor, ids.tenant)
    ).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" });
  });
  it.each([
    "00000000-0000-0000-0000-000000000001",
    "12345678-1234-f234-1234-123456789abc",
  ])("reads a persisted Core canonical UUID without version or variant restrictions (%s)", async id => {
    await saved();
    rows(s.estimateInternalApprovals)[0].id = id;
    const result = await getInternalApproval(ids.draft, ids.actor, ids.tenant);
    expect(result.state).toBe("active");
    expect(result.approval?.id).toBe(id);
    expect(mocks.adapter).toHaveBeenCalledOnce();
  });
  it("refuses a nil UUID in the persisted approval DTO", async () => {
    await saved();
    rows(s.estimateInternalApprovals)[0].id = "00000000-0000-0000-0000-000000000000";
    await expect(
      getInternalApproval(ids.draft, ids.actor, ids.tenant)
    ).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" });
  });
  it.each(["+010000-01-01T00:00:00.000Z", "-000001-01-01T00:00:00.000Z"])(
    "refuses decision dates outside the four-digit Timestamp grammar (%s)",
    async value => {
      await saved();
      const stamp = new Date(value);
      const draft = rows(s.estimateDrafts)[0];
      draft.approvedAt = stamp;
      draft.lockedAt = stamp;
      for (const table of [
        s.estimateInternalApprovalSnapshots,
        s.estimateInternalApprovals,
      ]) {
        rows(table)[0].createdAt = stamp;
        rows(table)[0].updatedAt = stamp;
      }
      rows(s.estimateInternalApprovals)[0].approvedAt = stamp;
      await expect(
        getInternalApproval(ids.draft, ids.actor, ids.tenant)
      ).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" });
    }
  );
  it.each([false, null, undefined, "true"])(
    "requires SQL source correspondence to be explicitly true (%s)",
    async answer => {
      await saved();
      tx.execute.mockResolvedValue([{ matches: answer }]);
      await expect(
        getInternalApproval(ids.draft, ids.actor, ids.tenant)
      ).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" });
    }
  );
  it("refuses approval replay if the original source no longer matches the immutable evidence", async () => {
    await saved();
    tx.execute.mockResolvedValue([{ matches: false }]);
    await expect(approve()).rejects.toMatchObject({
      code: "INTERNAL_APPROVAL_INTEGRITY_ERROR",
    });
    expect(rows(s.auditLogs)).toHaveLength(1);
  });
  it("refuses stored JSON that only matches after re-normalizing a reviewed label", async () => {
    await saved();
    rows(
      s.estimateInternalApprovalSnapshots
    )[0].snapshotPayload.presentation.bundleName = "  Synthetic assembly  ";
    await expect(
      getInternalApproval(ids.draft, ids.actor, ids.tenant)
    ).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" });
  });
  it("does not silently fallback when the SQL correspondence check fails", async () => {
    await saved();
    tx.execute.mockRejectedValue(
      new Error("Synthetic correspondence query failed")
    );
    await expect(
      getInternalApproval(ids.draft, ids.actor, ids.tenant)
    ).rejects.toThrow("Synthetic correspondence query failed");
  });
  it.each(["hash", "evaluation", "identity", "status", "orphan"] as const)(
    "fails closed on stored %s corruption",
    async kind => {
      await saved();
      if (kind === "hash")
        rows(s.estimateInternalApprovalSnapshots)[0].contentHash = "f".repeat(
          64
        );
      if (kind === "evaluation")
        rows(
          s.estimateInternalApprovalSnapshots
        )[0].policyEvaluation.profitMinor = "6001";
      if (kind === "identity")
        rows(s.estimateInternalApprovalSnapshots)[0].projectId = uuid(83);
      if (kind === "status") rows(s.estimateDrafts)[0].status = "draft";
      if (kind === "orphan") put(s.estimateInternalApprovals);
      await expect(
        getInternalApproval(ids.draft, ids.actor, ids.tenant)
      ).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" });
    }
  );
});
