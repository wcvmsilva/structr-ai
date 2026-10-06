/**
 * A1-VERSION-PREVIEW-IMPLEMENTATION-CONTRACT.md item 5 — router -> REAL helper
 * integration. Unlike `a1-version-preview-router.test.ts` (which mocks the public
 * helper to isolate router-only concerns), this file does NOT mock
 * `estimate-version-v2-db.ts` at all: `getEstimateVersionPreview` reached through
 * `estimateRouter.createCaller(...)` below calls the real exported
 * `getEstimateVersionPreviewV2`, running its real transaction/lock/lineage/newCopyPreview
 * logic (normalize/lock/read/newCopyPreview are never mocked, per the contract).
 *
 * Fixture technique copied from `estimate-version-v2-db.test.ts` (same in-memory
 * `getDb()` driver, same `./project-access`/`./internal-estimate-approval-adapter`
 * mocks, same `approvalRows()`/`makeInternalApprovalReviewInput()` fixtures, same
 * `approve()`-via-real-writer pattern for recorded-evidence setup) — not re-derived,
 * since that file already owns this in-memory driver. `requireProjectAccess` is a SPY
 * that still grants access by default, exactly as that file's does; it does not prove
 * the real production ACL/RBAC policy, only that THIS call reached authorization with
 * the right arguments inside the helper's own transaction.
 *
 * This file deliberately does NOT re-derive the exhaustive invariant matrix
 * `estimate-version-v2-db.test.ts` already covers at the helper level (legacy-status
 * refusal, undecided-source-carrying-decision-fields, H1 linkage, scope revalidation,
 * optional-reference checks, every malformed-command shape). It proves only that the
 * ROUTER reaches that real helper correctly for the scenarios item 5 names: current_draft
 * valid; recorded_a1 active AND revoked without reconsulting current review; recorded_a1
 * without decision and current_draft after decision refused; cross-tenant refused by the
 * transactional layer; write permission denied before any content copy; no mutation;
 * an already-superseded origin refused.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as s from "../drizzle/schema";
import { buildInternalApprovalReview, canonicalizeInternalApproval, type ReviewResult } from "../shared/internal-estimate-approval-engine";
import type { VersionCopySourceV2 } from "../shared/estimate-version-engine";
import { approvalRows } from "./internal-estimate-approval-adapter.fixtures";
import { approvalIds as ids, makeInternalApprovalReviewInput } from "./internal-estimate-approval-engine.fixtures";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), access: vi.fn(), review: vi.fn(), copy: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./project-access", async original => ({
  ...(await original<typeof import("./project-access")>()),
  requireProjectAccess: mocks.access,
}));
vi.mock("./internal-estimate-approval-adapter", () => ({
  buildInternalApprovalReviewFromRows: mocks.review,
  buildEstimateVersionCopyFromRows: mocks.copy,
}));

import { estimateRouter } from "./estimate-router";
import { ProjectAccessError } from "./project-access";
import { recordInternalEstimateApproval, revokeInternalEstimateApproval } from "./internal-estimate-approval-db";
import type { TrpcContext } from "./_core/context";

type Row = Record<string, any>;
type Table = Parameters<typeof getTableName>[0];
const uuid = (n: number) => `d9500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OTHER_TENANT = "d9900000-0000-4000-8000-000000000001";
const dialect = new PgDialect();
let data: Map<Table, Row[]>, trace: string[], db: any, tx: any;
let review: ReviewResult, content: VersionCopySourceV2, sequence: number;
const rows = (table: Table): Row[] => data.get(table) ?? [];
const put = (table: Table, ...values: Row[]) => data.set(table, values);
const source = () => rows(s.estimateDrafts).find(row => row.id === ids.draft)!;
const stableHash = (value: unknown) => createHash("sha256").update(canonicalizeInternalApproval(value)).digest("hex");

function matches(table: Table, condition: SQL | undefined, row: Row): boolean {
  if (!condition) throw new Error("Unscoped read or update");
  const query = dialect.sqlToQuery(condition);
  const columns = Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, column]) => [column.name, key]));
  let checked = 0;
  for (const item of query.sql.matchAll(/"[^"]+"\."([^"]+)" = \$(\d+)/g)) {
    checked++;
    if (row[columns[item[1]]] !== query.params[Number(item[2]) - 1]) return false;
  }
  for (const item of query.sql.matchAll(/"[^"]+"\."([^"]+)" in \(([^)]+)\)/gi)) {
    checked++;
    const values = [...item[2].matchAll(/\$(\d+)/g)].map(match => query.params[Number(match[1]) - 1]);
    if (!values.includes(row[columns[item[1]]])) return false;
  }
  if (!checked) throw new Error(`Unsupported predicate: ${query.sql}`);
  return true;
}
function select(selection?: Record<string, unknown>) {
  let table: Table, where: SQL | undefined, limit: number | undefined, lock: string | undefined;
  const query: any = {
    from: (value: Table) => ((table = value), query),
    where: (value: SQL) => ((where = value), query),
    limit: (value: number) => ((limit = value), query),
    orderBy: () => query,
    for: (value: string) => ((lock = value), query),
    then: (yes: any, no: any) => Promise.resolve().then(() => {
      trace.push(`read:${getTableName(table)}:${lock ?? "none"}`);
      let found = rows(table).filter(row => matches(table, where, row));
      if (limit !== undefined) found = found.slice(0, limit);
      if (selection) found = found.map(row => Object.fromEntries(Object.entries(selection).map(([key, column]) => {
        const field = Object.entries(getTableColumns(table)).find(([, actual]) => actual === column)?.[0];
        if (!field) throw new Error("Projection mismatch");
        return [key, row[field]];
      })));
      return structuredClone(found);
    }).then(yes, no),
  };
  return query;
}
function insert(table: Table) {
  return { values: (input: Row) => {
    const run = async () => {
      trace.push(`insert:${getTableName(table)}`);
      const added = { id: uuid(sequence++), createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...input };
      data.set(table, [...rows(table), structuredClone(added)]);
      return [structuredClone(added)];
    };
    return { returning: run, then: (yes: any, no: any) => run().then(yes, no) };
  } };
}
function update(table: Table) {
  return { set: (input: Row) => {
    let where: SQL | undefined;
    const run = async () => {
      trace.push(`update:${getTableName(table)}`);
      const changed: Row[] = [];
      put(table, ...rows(table).map(row => {
        if (!matches(table, where, row)) return row;
        const after = { ...row, ...input }; changed.push(after); return after;
      }));
      return structuredClone(changed);
    };
    const query: any = { where: (condition: SQL) => ((where = condition), query), returning: run, then: (yes: any, no: any) => run().then(yes, no) };
    return query;
  } };
}
function previewCommand(kind: "current_draft" | "recorded_a1" = "current_draft") {
  return { version: "estimate-version-preview-command-v2", sourceKind: kind, sourceDraftId: ids.draft, confirmedCurrencyCode: kind === "current_draft" ? "USD" : null };
}

function context(tenantId = ids.tenant): TrpcContext {
  return { req: {} as any, res: {} as any, authProvider: "legacy", tenantId, user: { id: ids.actor, tenantId, role: "user", isActive: true } as any };
}
const invoke = (kind: "current_draft" | "recorded_a1" = "current_draft", ctx = context()) =>
  estimateRouter.createCaller(ctx).getEstimateVersionPreview(previewCommand(kind));

async function approve(revoked = false) {
  const approved = await recordInternalEstimateApproval({ id: ids.draft, requestId: uuid(100), expectedDraftVersion: 1,
    expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Synthetic approval review" }, ids.actor, ids.tenant);
  if (revoked) await revokeInternalEstimateApproval({ id: ids.draft, approvalId: approved.approvalId, requestId: uuid(101),
    expectedContentHash: review.contentHash, reason: "Synthetic revocation review" }, ids.actor, ids.tenant);
  trace = []; mocks.copy.mockClear(); mocks.review.mockClear(); mocks.access.mockClear();
  return approved;
}
function trackNoWrites() {
  const before = { insert: tx.insert.mock.calls.length, update: tx.update.mock.calls.length };
  return () => {
    expect(tx.insert.mock.calls.length).toBe(before.insert);
    expect(tx.update.mock.calls.length).toBe(before.update);
  };
}

beforeEach(async () => {
  vi.clearAllMocks(); data = new Map(); trace = []; sequence = 1000;
  review = await buildInternalApprovalReview(makeInternalApprovalReviewInput());
  content = { ...review.snapshot, version: "estimate-version-copy-source-v2",
    financials: { ...review.snapshot.financials, currencyBasis: "version_request_confirmation" },
    copyProjection: { assemblyCount: 1, directZone: null } };
  const fixture = approvalRows();
  put(s.estimateDrafts, fixture.draft); put(s.projects, { ...fixture.project, ownerUserId: ids.actor });
  source().notes = review.snapshot.presentation.reviewedNotes;
  source().finishLevel = review.snapshot.commercialContext.pricingContext.finishLevel;
  source().region = review.snapshot.commercialContext.pricingContext.region;
  source().lineItems[0].taxable = review.snapshot.lines[0].taxable;
  put(s.clients, fixture.client); put(s.tenants, fixture.tenant); put(s.profiles, fixture.profile);
  put(s.geoZones, fixture.zone!);
  tx = { select: vi.fn(select), insert: vi.fn(insert), update: vi.fn(update), execute: vi.fn(async (input: SQL) => {
    const query = dialect.sqlToQuery(input);
    if (!query.sql.includes("internal_approval_draft_matches_v1")) throw new Error("Unexpected SQL execution");
    trace.push("check:recorded-source"); return [{ matches: true }];
  }) };
  db = { transaction: vi.fn(async (work: (connection: typeof tx) => Promise<unknown>, options: { isolationLevel: string }) => {
    trace.push(`begin:${options.isolationLevel}`);
    try {
      const result = await work(tx);
      trace.push("commit"); return result;
    } catch (error) { trace.push("rollback"); throw error; }
  }) };
  mocks.getDb.mockResolvedValue(db);
  mocks.access.mockImplementation(async () => { trace.push("authorize"); return { projectId: ids.project, tenantId: ids.tenant, via: "owner" }; });
  mocks.review.mockImplementation(async () => { trace.push("review:approval"); return structuredClone(review); });
  mocks.copy.mockImplementation(async () => { trace.push("review:copy"); return { content: structuredClone(content), contentHash: stableHash(content) }; });
});

describe("getEstimateVersionPreview — through the REAL router and REAL helper", () => {
  it("produces the current_draft preview using WRITE authorization, with no mutation", async () => {
    const checkNoWrites = trackNoWrites();
    const result = await invoke("current_draft");
    expect(result).toMatchObject({ sourceKind: "current_draft", sourceApprovalId: null, content });
    expect(mocks.access).toHaveBeenCalledWith(ids.project, ids.actor, "write", expect.objectContaining({ transaction: tx, expectedTenantId: ids.tenant }));
    expect(trace[0]).toBe("begin:serializable");
    expect(trace.at(-1)).toBe("commit");
    checkNoWrites();
  });

  it.each([false, true])("returns recorded_a1 evidence (revoked=%s) without reconsulting the current review/copy adapters", async revoked => {
    const approved = await approve(revoked);
    const checkNoWrites = trackNoWrites();
    const result = await invoke("recorded_a1");
    expect(result).toMatchObject({ sourceKind: "recorded_a1", sourceApprovalId: approved.approvalId, sourceApprovalState: revoked ? "revoked" : "active", confirmedCurrencyCode: null });
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.review).not.toHaveBeenCalled();
    checkNoWrites();
  });

  it("refuses recorded_a1 for an undecided source as a conflict, not a silent fabrication", async () => {
    const checkNoWrites = trackNoWrites();
    await expect(invoke("recorded_a1")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.copy).not.toHaveBeenCalled();
    checkNoWrites();
  });

  it("refuses current_draft once a decision already exists, as a conflict", async () => {
    await approve();
    const checkNoWrites = trackNoWrites();
    await expect(invoke("current_draft")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.copy).not.toHaveBeenCalled();
    checkNoWrites();
  });

  it("refuses an already-superseded source (a version already created from it) without copying content", async () => {
    source().supersededBy = uuid(999);
    const checkNoWrites = trackNoWrites();
    await expect(invoke("current_draft")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.copy).not.toHaveBeenCalled();
    checkNoWrites();
  });

  it("refuses a draft belonging to a different tenant with the real transactional lock (NOT_FOUND), before authorization is ever reached", async () => {
    const checkNoWrites = trackNoWrites();
    await expect(invoke("current_draft", context(OTHER_TENANT))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.access).not.toHaveBeenCalled();
    checkNoWrites();
  });

  it("propagates a write-permission denial exactly, rolls the transaction back, and copies no content", async () => {
    mocks.access.mockRejectedValue(new ProjectAccessError("FORBIDDEN", "Access changed since preview"));
    const checkNoWrites = trackNoWrites();
    await expect(invoke("current_draft")).rejects.toMatchObject({ code: "FORBIDDEN", message: "Access changed since preview" });
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(trace.at(-1)).toBe("rollback");
    checkNoWrites();
  });

  it("a repeated read performs no mutation on either call", async () => {
    const checkNoWrites = trackNoWrites();
    await invoke("current_draft");
    await invoke("current_draft");
    checkNoWrites();
  });
});
