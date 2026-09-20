/** Version orchestration with the real Core transaction/context/lineage/reader
 * and a transactional storage fake. This does not prove physical scheduling.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import * as s from "../drizzle/schema";
import {
  buildInternalApprovalReview, canonicalizeInternalApproval, type ReviewResult,
} from "../shared/internal-estimate-approval-engine";
import type { VersionCopySourceV2 } from "../shared/estimate-version-engine";
import { approvalRows } from "./internal-estimate-approval-adapter.fixtures";
import { approvalIds as ids, makeInternalApprovalReviewInput } from "./internal-estimate-approval-engine.fixtures";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), access: vi.fn(), review: vi.fn(), copy: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./project-access", () => ({ requireProjectAccess: mocks.access }));
vi.mock("./internal-estimate-approval-adapter", () => ({
  buildInternalApprovalReviewFromRows: mocks.review,
  buildEstimateVersionCopyFromRows: mocks.copy,
}));
import { recordInternalEstimateApproval, revokeInternalEstimateApproval } from "./internal-estimate-approval-db";
import { getEstimateVersionPreviewV2, createEstimateVersionV2 } from "./estimate-version-v2-db";

type Row = Record<string, any>;
type Table = Parameters<typeof getTableName>[0];
const uuid = (n: number) => `d9400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const requestId = uuid(1), other = uuid(2);
const dialect = new PgDialect();
let data: Map<Table, Row[]>, trace: string[], db: any, tx: any;
let review: ReviewResult, content: VersionCopySourceV2, sequence: number;
let fault: "insert" | "pointer" | "audit" | "audit_missing" | "audit_transient" | null;
let commitFaults: unknown[], sourceMatches: boolean;
let insertFailure: unknown, auditDriverFailure: unknown;
const rows = (table: Table): Row[] => data.get(table) ?? [];
const put = (table: Table, ...values: Row[]) => data.set(table, values);
const source = () => rows(s.estimateDrafts).find(row => row.id === ids.draft)!;
const stableHash = (value: unknown) => createHash("sha256").update(canonicalizeInternalApproval(value)).digest("hex");

function matches(table: Table, condition: SQL | undefined, row: Row): boolean {
  if (!condition) throw new Error("Unscoped read or update");
  const query = dialect.sqlToQuery(condition);
  const columns = Object.fromEntries(Object.entries(getTableColumns(table)).map(([key, column]) => [column.name, key]));
  let checked = 0;
  for (const item of query.sql.matchAll(/"[^\"]+"\."([^\"]+)" = \$(\d+)/g)) {
    checked++;
    if (row[columns[item[1]]] !== query.params[Number(item[2]) - 1]) return false;
  }
  for (const item of query.sql.matchAll(/"[^\"]+"\."([^\"]+)" in \(([^)]+)\)/gi)) {
    checked++;
    const values = [...item[2].matchAll(/\$(\d+)/g)].map(match => query.params[Number(match[1]) - 1]);
    if (!values.includes(row[columns[item[1]]])) return false;
  }
  if (!checked) throw new Error(`Unsupported predicate: ${query.sql}`);
  return true;
}
function decoded(value: unknown): unknown {
  if (!(value instanceof SQL)) return value;
  const query = dialect.sqlToQuery(value);
  if (!/^\$1::jsonb$/.test(query.sql.trim()) || query.params.length !== 1 || typeof query.params[0] !== "string") {
    throw new Error("Expected a bound JSON string, not a cast of legacy numeric DTOs");
  }
  return JSON.parse(query.params[0]);
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
      if (selection && Object.values(selection).some(value => value instanceof SQL)) {
        const entries = Object.entries(selection);
        if (entries.length !== 1 || !(entries[0][1] instanceof SQL)
          || !/max\("estimate_drafts"\."version"\)/i.test(dialect.sqlToQuery(entries[0][1]).sql)) {
          throw new Error("Unexpected aggregate");
        }
        return [{ [entries[0][0]]: found.length ? Math.max(...found.map(row => row.version)) : null }];
      }
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
      if (table === s.auditLogs) {
        if (auditDriverFailure) throw auditDriverFailure;
        if (fault === "audit_missing") return [];
        if (fault === "audit" || fault === "audit_transient") {
          throw Object.assign(new Error("Synthetic private audit detail"), fault === "audit_transient" ? { code: "40001" } : {});
        }
      }
      if (table === s.estimateDrafts && fault === "insert") throw new Error("Synthetic child insert failure");
      if (table === s.estimateDrafts && insertFailure) throw insertFailure;
      const value = Object.fromEntries(Object.entries(input).map(([key, item]) => [key, decoded(item)]));
      const added = { id: uuid(sequence++), createdAt: new Date(), updatedAt: new Date(), deletedAt: null, ...value };
      // Draft columns intentionally receive no fake defaults: the projector must supply all 54.
      const result = table === s.estimateDrafts ? value : added;
      data.set(table, [...rows(table), structuredClone(result)]);
      return [structuredClone(result)];
    };
    return { returning: run, then: (yes: any, no: any) => run().then(yes, no) };
  } };
}
function update(table: Table) {
  return { set: (input: Row) => {
    let where: SQL | undefined;
    const run = async () => {
      trace.push(`update:${getTableName(table)}`);
      if (fault === "pointer" && table === s.estimateDrafts && input.supersededBy) throw new Error("Synthetic pointer failure");
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
function command(kind: "current_draft" | "recorded_a1" = "current_draft") {
  return { version: "estimate-version-command-v2", sourceKind: kind, sourceDraftId: ids.draft, requestId,
    expectedSourceVersion: 1, expectedSourceContentHash: kind === "current_draft" ? stableHash(content) : review.contentHash,
    confirmedCurrencyCode: kind === "current_draft" ? "USD" : null, name: null, reason: "Synthetic version revision" };
}
const preview = (input: unknown = previewCommand()) => getEstimateVersionPreviewV2(input, ids.actor, ids.tenant);
const create = (input: unknown = command()) => createEstimateVersionV2(input, ids.actor, ids.tenant);
const writes = () => trace.filter(value => /^(insert|update):/.test(value));
const childFor = (result: { draftId: string }) => rows(s.estimateDrafts).find(row => row.id === result.draftId)!;

async function approve(revoked = false) {
  const approved = await recordInternalEstimateApproval({ id: ids.draft, requestId: uuid(100), expectedDraftVersion: 1,
    expectedContentHash: review.contentHash, expectedPolicyHash: review.policyHash, confirmedCurrencyCode: "USD", reason: "Synthetic approval review" }, ids.actor, ids.tenant);
  if (revoked) await revokeInternalEstimateApproval({ id: ids.draft, approvalId: approved.approvalId, requestId: uuid(101),
    expectedContentHash: review.contentHash, reason: "Synthetic revocation review" }, ids.actor, ids.tenant);
  trace = []; mocks.copy.mockClear(); mocks.review.mockClear();
  return approved;
}
async function scopedApproval() {
  const scopeId = uuid(200);
  review = await buildInternalApprovalReview({ ...makeInternalApprovalReviewInput(),
    scopeReference: { association: "draft_link_only", scopeDraftId: scopeId, reviewSnapshotId: null },
  });
  source().scopeDraftId = scopeId;
  put(s.scopeDrafts, { id: scopeId, tenantId: ids.tenant, projectId: ids.project });
  await approve();
  return scopeId;
}

beforeEach(async () => {
  vi.clearAllMocks(); data = new Map(); trace = []; sequence = 1000;
  fault = null; commitFaults = []; sourceMatches = true;
  insertFailure = null; auditDriverFailure = null;
  review = await buildInternalApprovalReview(makeInternalApprovalReviewInput());
  content = { ...review.snapshot, version: "estimate-version-copy-source-v2",
    financials: { ...review.snapshot.financials, currencyBasis: "version_request_confirmation" },
    copyProjection: { assemblyCount: 1, directZone: null } };
  const fixture = approvalRows();
  put(s.estimateDrafts, fixture.draft); put(s.projects, { ...fixture.project, ownerUserId: ids.actor });
  // The canned review and raw source represent the same original content;
  // only the SQL integrity check itself is modeled by sourceMatches below.
  source().notes = review.snapshot.presentation.reviewedNotes;
  source().finishLevel = review.snapshot.commercialContext.pricingContext.finishLevel;
  source().region = review.snapshot.commercialContext.pricingContext.region;
  source().lineItems[0].taxable = review.snapshot.lines[0].taxable;
  put(s.clients, fixture.client); put(s.tenants, fixture.tenant); put(s.profiles, fixture.profile);
  put(s.geoZones, fixture.zone!);
  tx = { select: vi.fn(select), insert: vi.fn(insert), update: vi.fn(update), execute: vi.fn(async (input: SQL) => {
    const query = dialect.sqlToQuery(input);
    if (!query.sql.includes("internal_approval_draft_matches_v1")) throw new Error("Unexpected SQL execution");
    trace.push("check:recorded-source"); return [{ matches: sourceMatches }];
  }) };
  db = { transaction: vi.fn(async (work: (connection: typeof tx) => Promise<unknown>, options: { isolationLevel: string }) => {
    trace.push(`begin:${options.isolationLevel}`);
    const before = new Map([...data].map(([table, values]) => [table, structuredClone(values)]));
    try {
      const result = await work(tx); const problem = commitFaults.shift(); if (problem) throw problem;
      trace.push("commit"); return result;
    } catch (error) { data = before; trace.push("rollback"); throw error; }
  }) };
  mocks.getDb.mockResolvedValue(db);
  mocks.access.mockImplementation(async () => { trace.push("authorize"); return { projectId: ids.project, tenantId: ids.tenant, via: "owner" }; });
  mocks.review.mockImplementation(async () => { trace.push("review:approval"); return structuredClone(review); });
  mocks.copy.mockImplementation(async () => { trace.push("review:copy"); return { content: structuredClone(content), contentHash: stableHash(content) }; });
});

describe("version previews with current transaction authority", () => {
  it("uses write authorization, project/draft locks and the same rows/transaction before preview", async () => {
    const result = await preview();
    expect(result).toMatchObject({ sourceKind: "current_draft", sourceContentHash: stableHash(content), sourceApprovalId: null, content });
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "serializable" });
    expect(mocks.access).toHaveBeenCalledWith(ids.project, ids.actor, "write", { mode: "a1", transaction: tx, expectedTenantId: ids.tenant });
    expect(trace.indexOf("read:projects:update")).toBeLessThan(trace.indexOf("read:estimate_drafts:update"));
    expect(trace.indexOf("authorize")).toBeLessThan(trace.indexOf("review:copy"));
    expect(writes()).toEqual([]);
  });
  it.each([false, true])("reads %s revoked recorded evidence without a new geo/policy review", async revoked => {
    const result = await approve(revoked); source().notes = "Later operational notes";
    const response = await preview(previewCommand("recorded_a1"));
    expect(response).toMatchObject({ sourceApprovalId: result.approvalId, sourceApprovalState: revoked ? "revoked" : "active", content: review.snapshot });
    expect(mocks.copy).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled(); expect(writes()).toEqual([]);
  });
  it.each(["preview", "create"])("validates malformed command before %s opens a transaction", async operation => {
    const run = operation === "preview" ? preview : create;
    await expect(run({ sourceDraftId: ids.draft })).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INPUT_INVALID" });
    expect(db.transaction).not.toHaveBeenCalled();
  });
  it.each(["approved", "rejected", "archived", "converted"])("refuses legacy/current status %s without A1 evidence", async status => {
    source().status = status;
    await expect(preview()).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" });
    expect(mocks.copy).not.toHaveBeenCalled(); expect(writes()).toEqual([]);
  });
  it("refuses a recorded branch expectation for an undecided source", async () => {
    await expect(preview(previewCommand("recorded_a1"))).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_REVIEW_STALE" });
    expect(mocks.copy).not.toHaveBeenCalled();
  });
  it("refuses a draft branch expectation once a decision exists", async () => {
    await approve();
    await expect(preview()).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_REVIEW_STALE" });
    expect(mocks.copy).not.toHaveBeenCalled();
  });
  it.each(["supersededBy", "lockedAt", "approvedAt", "approvedBy"])("refuses an undecided source carrying %s", async field => {
    source()[field] = field.endsWith("At") ? new Date() : other;
    await expect(preview()).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" });
    expect(mocks.copy).not.toHaveBeenCalled();
  });
  it("denies withdrawn authorization before any copy-money interpretation", async () => {
    const error = new Error("Synthetic access denial"); mocks.access.mockRejectedValue(error);
    await expect(create()).rejects.toBe(error); expect(mocks.copy).not.toHaveBeenCalled(); expect(writes()).toEqual([]);
  });
  it.each([s.tenants, s.profiles, s.clients])("requires active present context in table %#", async table => {
    rows(table)[0].isActive = false;
    await expect(create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.copy).not.toHaveBeenCalled(); expect(writes()).toEqual([]);
  });
  it("rejects H1 linkage before the adapter even when source text was altered", async () => {
    put(s.historicalEstimateImports, { id: other, estimateDraftId: ids.draft });
    await expect(create()).rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" });
    expect(mocks.copy).not.toHaveBeenCalled(); expect(writes()).toEqual([]);
  });
  it("validates optional references in preview without finding replacement rows", async () => {
    source().bundleId = other; content.origin.bundleId = other;
    await expect(preview()).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" });
    expect(writes()).toEqual([]);
  });
  it.each(["missing", "tenant", "project"])("rejects a recorded scope that is now %s", async scenario => {
    await scopedApproval();
    if (scenario === "missing") put(s.scopeDrafts);
    else rows(s.scopeDrafts)[0][scenario === "tenant" ? "tenantId" : "projectId"] = other;
    await expect(preview(previewCommand("recorded_a1"))).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" });
    expect(writes()).toEqual([]);
  });
  it("checks a recorded scope's current exact tenant/project with SHARE before a new copy", async () => {
    const scopeId = await scopedApproval();
    const result = await create(command("recorded_a1"));
    expect(childFor(result).scopeDraftId).toBe(scopeId);
    expect(trace).toContain("read:scope_drafts:share");
  });
});

describe("atomic closed version creation", () => {
  it("inserts all 54 columns, keeps exact JSON money and then records pointer/audit", async () => {
    source().draftData = { authority: "do not copy" }; source().metadata = { arbitrary: "do not copy" };
    const result = await create(); const child = childFor(result);
    expect(result).toEqual({ draftId: child.id, draftVersion: 2, supersedesId: ids.draft, replayed: false });
    expect(Object.keys(child).sort()).toEqual(Object.keys(getTableColumns(s.estimateDrafts)).sort());
    expect(child).toMatchObject({ tenantId: ids.tenant, projectId: ids.project, clientId: ids.client, createdBy: ids.actor,
      status: "draft", source: "version", supersedesId: ids.draft, a1VersionRequestId: requestId,
      draftData: null, metadata: null, approvedBy: null, approvedAt: null, lockedAt: null,
      rejectedBy: null, rejectedAt: null, rejectionReason: null, profitShieldEvaluation: null, warningsJson: null,
      subtotalPrice: "100.00", subtotalCost: "40.00", finalTotalPrice: "100.00", discountApplied: false, discountAmount: "0.00" });
    expect(child.lineItems[0]).toMatchObject({ quantity: "2", lineTotalPrice: "100.00", lineTotalCost: "40.00" });
    expect(child.assemblySelections[0]).toMatchObject({ quantity: "2", extendedPrice: "100.00", extendedCost: "40.00" });
    expect(source().supersededBy).toBe(child.id); expect(source().updatedAt).toEqual(child.createdAt);
    expect(child.createdAt).toEqual(child.updatedAt);
    expect(writes()).toEqual(["insert:estimate_drafts", "update:estimate_drafts", "insert:audit_logs"]);
    expect(rows(s.auditLogs)[0]).toMatchObject({ action: "estimate.version_created", userId: ids.actor, recordId: ids.draft });
    expect(rows(s.auditLogs)[0].oldValues.supersededBy).toBeNull();
    expect(rows(s.auditLogs)[0].newValues.supersededBy).toBe(child.id);
    expect(rows(s.auditLogs)[0].newValues.createdAt).toBe(child.createdAt.toISOString());
    expect(rows(s.estimateInternalApprovalSnapshots)).toEqual([]);
  });
  it.each([false, true])("copies recorded evidence with revoked=%s without live projection or reapproval", async revoked => {
    await approve(revoked); source().notes = "Operational note changed after decision";
    const before = rows(s.estimateInternalApprovals).length;
    const result = await create(command("recorded_a1")); const child = childFor(result);
    expect(child.notes).toBe(review.snapshot.presentation.reviewedNotes);
    expect(child.assemblyCount).toBe(review.snapshot.assemblySelections.length);
    expect(child.zone).toBe(review.snapshot.commercialContext.pricingContext.zone);
    expect(child.status).toBe("draft"); expect(rows(s.estimateInternalApprovals)).toHaveLength(before);
    expect(mocks.copy).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled();
  });
  it("allocates above the authorized project's maximum rather than the source version", async () => {
    put(s.estimateDrafts, source(), { ...source(), id: other, version: 7 }, { ...source(), id: uuid(3), projectId: uuid(4), version: 99 });
    expect((await create()).draftVersion).toBe(8);
  });
  it("rejects allocation overflow before INSERT", async () => {
    put(s.estimateDrafts, source(), { ...source(), id: other, version: 2147483647 });
    await expect(create()).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" }); expect(writes()).toEqual([]);
  });
  it.each(["expectedSourceVersion", "expectedSourceContentHash"])("rejects stale %s without any write", async field => {
    await expect(create({ ...command(), [field]: field.endsWith("Version") ? 2 : "a".repeat(64) })).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_REVIEW_STALE" });
    expect(writes()).toEqual([]);
  });
  it("rechecks an optional reference after preview and before writing", async () => {
    content.origin.bundleId = other; source().bundleId = other;
    put(s.bundles, { id: other, tenantId: ids.tenant, isActive: false });
    await preview(); put(s.bundles, { id: other, tenantId: uuid(40) }); trace = [];
    await expect(create()).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" }); expect(writes()).toEqual([]);
  });
  it.each(["insert", "pointer", "audit", "audit_missing", "audit_transient"] as const)("rolls back the entire %s failure", async kind => {
    fault = kind;
    const before = structuredClone(rows(s.estimateDrafts));
    await expect(create()).rejects.toThrow();
    expect(rows(s.estimateDrafts)).toEqual(before); expect(rows(s.auditLogs)).toEqual([]);
    expect(db.transaction).toHaveBeenCalledTimes(1); expect(trace).not.toContain("commit");
  });
  it("retries a serialization failure with one visible child and one audit", async () => {
    commitFaults = [Object.assign(new Error("Synthetic serialization"), { code: "40001" })];
    const result = await create();
    expect(db.transaction).toHaveBeenCalledTimes(2); expect(rows(s.estimateDrafts)).toHaveLength(2); expect(rows(s.auditLogs)).toHaveLength(1);
    expect(source().supersededBy).toBe(result.draftId);
  });
  it.each([false, true])("maps only the named A1 request constraint after rollback, wrapped=%s", async wrapped => {
    const driver = Object.assign(new Error("Synthetic request collision"), { code: "23505", constraint_name: "uq_ed_a1_version_request" });
    insertFailure = wrapped ? new Error("Synthetic query wrapper", { cause: driver }) : driver;
    await expect(create()).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_REQUEST_CONFLICT" });
    expect(rows(s.estimateDrafts)).toHaveLength(1); expect(rows(s.auditLogs)).toEqual([]);
    expect(db.transaction).toHaveBeenCalledTimes(1); expect(trace).not.toContain("commit");
  });
  it.each(["estimate_drafts_pkey", "uq_ed_a1_version_successor", undefined])("does not relabel unrelated uniqueness %s as a request conflict", async constraint_name => {
    insertFailure = Object.assign(new Error("Synthetic unrelated uniqueness"), { code: "23505", constraint_name });
    await expect(create()).rejects.toBe(insertFailure);
    expect(rows(s.estimateDrafts)).toHaveLength(1); expect(rows(s.auditLogs)).toEqual([]);
  });
  it("does not relabel an audit failure carrying a request constraint", async () => {
    auditDriverFailure = Object.assign(new Error("Synthetic private audit uniqueness"), { code: "23505", constraint_name: "uq_ed_a1_version_request" });
    await expect(create()).rejects.toMatchObject({ name: "InternalApprovalAuditFailure" });
    expect(rows(s.estimateDrafts)).toHaveLength(1); expect(rows(s.auditLogs)).toEqual([]);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
  it("does not relabel a cyclic error cause as a proven request conflict", async () => {
    const error: Error & { code: string; constraint_name: string; cause?: unknown } = Object.assign(new Error("Synthetic ambiguous cause"), { code: "23505", constraint_name: "uq_ed_a1_version_request" });
    error.cause = error; insertFailure = error;
    await expect(create()).rejects.toBe(error);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });
});

describe("permanent request replay before new-copy conditions", () => {
  it("replays the edited child before a new source review, branch check or optional lookup", async () => {
    content.origin.bundleId = other; source().bundleId = other;
    put(s.bundles, { id: other, tenantId: ids.tenant, isActive: true });
    const input = command(); const first = await create(input); const child = childFor(first);
    child.notes = "Legitimate operational edit"; child.discountAmount = "5.00"; child.finalTotalPrice = "95.00";
    // Lifecycle can advance after creation without changing the permanent request.
    source().status = "archived"; put(s.bundles); trace = []; mocks.copy.mockClear();
    const second = await create(input);
    expect(second).toEqual({ ...first, replayed: true }); expect(childFor(second).finalTotalPrice).toBe("95.00");
    expect(mocks.copy).not.toHaveBeenCalled(); expect(writes()).toEqual([]);
    expect(trace.some(value => value.startsWith("read:bundles"))).toBe(false);
  });
  it("replays after revocation without altering the recorded content hash", async () => {
    const approved = await approve(); const input = command("recorded_a1"); const first = await create(input);
    await revokeInternalEstimateApproval({ id: ids.draft, approvalId: approved.approvalId, requestId: uuid(102),
      expectedContentHash: review.contentHash, reason: "Synthetic later revocation" }, ids.actor, ids.tenant);
    trace = []; mocks.copy.mockClear(); mocks.review.mockClear();
    expect(await create(input)).toEqual({ ...first, replayed: true }); expect(writes()).toEqual([]);
    expect(mocks.copy).not.toHaveBeenCalled(); expect(mocks.review).not.toHaveBeenCalled();
  });
  it.each(["name", "reason", "expectedSourceContentHash"])("conflicts when the same request changes %s", async field => {
    const input = command(); await create(input); trace = [];
    await expect(create({ ...input, [field]: field === "expectedSourceContentHash" ? "b".repeat(64) : "Different reviewed request" }))
      .rejects.toMatchObject({ code: "INTERNAL_APPROVAL_REQUEST_CONFLICT" }); expect(writes()).toEqual([]);
  });
  it.each(["createdBy", "tenantId", "projectId", "clientId", "source", "supersedesId", "a1VersionRequestHash"])("refuses a replay with inconsistent child %s", async field => {
    const input = command(); const result = await create(input); childFor(result)[field] = field === "source" ? "assembly_calculator" : other; trace = [];
    await expect(create(input)).rejects.toThrow(); expect(writes()).toEqual([]);
  });
  it("refuses replay if the permanent parent backpointer is inconsistent", async () => {
    const input = command(); await create(input); source().supersededBy = other; trace = [];
    await expect(create(input)).rejects.toThrow(); expect(writes()).toEqual([]);
  });
  it("refuses a canonical child version that is not greater than the source version", async () => {
    const input = command(); const result = await create(input); childFor(result).version = source().version; trace = [];
    await expect(create(input)).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_REQUEST_CONFLICT" }); expect(writes()).toEqual([]);
  });
  it("does not require a recorded scope again for replay after the copy committed", async () => {
    await scopedApproval(); const input = command("recorded_a1"); const first = await create(input);
    put(s.scopeDrafts); trace = [];
    expect(await create(input)).toEqual({ ...first, replayed: true });
    expect(trace.some(value => value.startsWith("read:scope_drafts"))).toBe(false);
    expect(writes()).toEqual([]);
  });
  it("revalidates current child H1 linkage before returning replay", async () => {
    const input = command(); const result = await create(input);
    put(s.historicalEstimateImports, { id: other, estimateDraftId: result.draftId }); trace = [];
    await expect(create(input)).rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" }); expect(writes()).toEqual([]);
  });
  it("revalidates child ancestry independently of the source lineage", async () => {
    const input = command(); const result = await create(input); childFor(result).changeOrderOf = other;
    put(s.estimateDrafts, ...rows(s.estimateDrafts), { ...source(), id: other, source: "historical_import", supersedesId: null, supersededBy: null });
    trace = [];
    await expect(create(input)).rejects.toMatchObject({ code: "HISTORICAL_AUTHORITY_NOT_AVAILABLE" }); expect(writes()).toEqual([]);
  });
  it("revalidates current permission instead of returning a previously authorized request", async () => {
    const input = command(); await create(input); trace = [];
    const denied = new Error("Synthetic access revoked"); mocks.access.mockRejectedValue(denied);
    await expect(create(input)).rejects.toBe(denied); expect(writes()).toEqual([]);
  });
  it("does not create another child when the source is already superseded under a different request", async () => {
    await create(); trace = [];
    await expect(create({ ...command(), requestId: other })).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" }); expect(writes()).toEqual([]);
  });
  it("checks recorded-source integrity even during replay", async () => {
    await approve(); const input = command("recorded_a1"); await create(input); sourceMatches = false; trace = [];
    await expect(create(input)).rejects.toMatchObject({ code: "INTERNAL_APPROVAL_INTEGRITY_ERROR" }); expect(writes()).toEqual([]);
  });
});
