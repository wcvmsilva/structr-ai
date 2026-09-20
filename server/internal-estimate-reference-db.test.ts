/** Same-handle reference reads through a transactional storage fake.
 * This is application behavior evidence, not proof of PostgreSQL lock scheduling.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableColumns, getTableName, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { estimates, bundles, intakeForms } from "../drizzle/schema";
import type { AuthTransaction } from "./auth-transaction";
import { InternalApprovalError } from "../shared/internal-estimate-approval-engine";

const external = vi.hoisted(() => ({ getDb: vi.fn(), audit: vi.fn(), auth: vi.fn() }));
vi.mock("./db", () => ({ getDb: external.getDb }));
vi.mock("./audit", () => ({ logAudit: external.audit }));
vi.mock("./project-access", () => ({ requireProjectAccess: external.auth }));
import { assertInternalEstimateReferences } from "./internal-estimate-reference-db";

type Origin = Parameters<typeof assertInternalEstimateReferences>[1];
type Context = Parameters<typeof assertInternalEstimateReferences>[2];
type Table = typeof estimates | typeof bundles | typeof intakeForms;
type Row = Record<string, unknown>;
type Read = { table: string; id: unknown; lock: string | undefined; handle: object; fields: string[] };
const id = (n: number) => `e6300000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const TENANT = id(1), PROJECT = id(2), CLIENT = id(3), ESTIMATE = id(4), BUNDLE = id(5), INTAKE = id(6), OTHER = id(7);
const nil = "00000000-0000-0000-0000-000000000000";
const context: Context = { tenantId: TENANT, projectId: PROJECT, clientId: CLIENT };
const origin: Origin = { estimateId: ESTIMATE, bundleId: BUNDLE, intakeFormId: INTAKE };
const empty: Origin = { estimateId: null, bundleId: null, intakeFormId: null };
const dialect = new PgDialect();
let storage: Map<Table, Row[]>;
let reads: Read[];
let trace: string[];
let active: boolean;
let readFailure: unknown;
let tx: AuthTransaction;
let forbiddenWrite: ReturnType<typeof vi.fn>;
const tableCases = [
  ["estimate", estimates, "estimateId", ESTIMATE],
  ["bundle", bundles, "bundleId", BUNDLE],
  ["intake", intakeForms, "intakeFormId", INTAKE],
] as const;
const row = (table: Table): Row => storage.get(table)![0];

function makeTransaction(): AuthTransaction {
  const handle = {
    select: vi.fn((selection?: Record<string, unknown>) => {
      let table: Table, where: SQL | undefined, lock: string | undefined;
      let limit: number | undefined;
      const query = {
        from(value: Table) { table = value; return query; },
        where(value: SQL) { where = value; return query; },
        for(value: string) { lock = value; return query; },
        limit(value: number) { limit = value; return query; },
        then<TResult1 = Row[], TResult2 = never>(
          yes?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
          no?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ): Promise<TResult1 | TResult2> {
          return Promise.resolve().then(() => {
            if (!active) throw new Error("Reference read escaped the caller transaction");
            if (!storage.has(table) || !where) throw new Error("Unexpected table or missing predicate");
            const compiled = dialect.sqlToQuery(where);
            const expected = new RegExp(`^"${getTableName(table)}"\\."id" = \\$1$`);
            if (!expected.test(compiled.sql) || compiled.params.length !== 1) {
              throw new Error(`Expected exact reviewed-ID predicate: ${compiled.sql}`);
            }
            if (!selection) throw new Error("Only reference identity fields may be read");
            const columns = getTableColumns(table);
            const fields = Object.keys(selection);
            const allowed = table === bundles ? ["id", "tenantId"]
              : table === estimates ? ["id", "tenantId", "projectId"]
              : ["id", "tenantId", "projectId", "formData"];
            if (fields.some(field => !allowed.includes(field))) throw new Error("Reference validation read unrelated commercial data");
            const reviewedId = compiled.params[0];
            reads.push({ table: getTableName(table), id: reviewedId, lock, handle, fields });
            trace.push(`read:${getTableName(table)}:${lock}`);
            if (readFailure) throw readFailure;
            const found = storage.get(table)!.filter(value => value.id === reviewedId).map(value => Object.fromEntries(
              Object.entries(selection).map(([key, column]) => {
                const entry = Object.entries(columns).find(([, actual]) => actual === column);
                if (!entry) throw new Error("Projection referenced another table");
                return [key, value[entry[0]]];
              }),
            ));
            return limit === undefined ? found : found.slice(0, limit);
          }).then(yes, no);
        },
      };
      return query;
    }),
    insert: forbiddenWrite, update: forbiddenWrite, delete: forbiddenWrite,
    execute: forbiddenWrite, transaction: forbiddenWrite,
  };
  return handle as unknown as AuthTransaction;
}

async function run(refs: Origin = origin, auth: Context = context): Promise<void> {
  const before = structuredClone([...storage].map(([table, rows]) => [getTableName(table), rows]));
  trace.push("begin"); active = true;
  try {
    await assertInternalEstimateReferences(tx, refs, auth);
    trace.push("commit");
  } catch (error) {
    trace.push("rollback");
    throw error;
  } finally {
    active = false;
    expect([...storage].map(([table, rows]) => [getTableName(table), rows])).toEqual(before);
    expect(forbiddenWrite).not.toHaveBeenCalled();
    expect(external.getDb).not.toHaveBeenCalled();
    expect(external.audit).not.toHaveBeenCalled();
    expect(external.auth).not.toHaveBeenCalled();
  }
}

async function expectUnresolved(refs: Origin = origin, auth: Context = context) {
  let error: unknown;
  try { await run(refs, auth); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(InternalApprovalError);
  expect(error).toMatchObject({ code: "INTERNAL_APPROVAL_CONTENT_UNRESOLVED" });
  expect((error as Error).message).not.toContain(OTHER);
  expect(trace).not.toContain("commit");
}

beforeEach(() => {
  vi.clearAllMocks();
  storage = new Map<Table, Row[]>([
    [estimates, [{ id: ESTIMATE, tenantId: TENANT, projectId: PROJECT, status: "draft" }]],
    [bundles, [{ id: BUNDLE, tenantId: TENANT, isActive: true, validFrom: "2099-01-01", validUntil: "2000-01-01" }]],
    [intakeForms, [{ id: INTAKE, tenantId: TENANT, projectId: PROJECT, status: "draft", formData: null }]],
  ]);
  reads = []; trace = []; active = false; readFailure = null;
  forbiddenWrite = vi.fn(() => { throw new Error("References cannot write or open another transaction"); });
  for (const fn of Object.values(external)) fn.mockImplementation(() => { throw new Error("References cannot load external context"); });
  tx = makeTransaction();
});

describe("reviewed optional references in the caller transaction", () => {
  it("validates all three exact rows in fixed order with SHARE on the same handle", async () => {
    await expect(run()).resolves.toBeUndefined();
    expect(reads.map(({ table, id, lock }) => ({ table, id, lock }))).toEqual([
      { table: "estimates", id: ESTIMATE, lock: "share" },
      { table: "bundles", id: BUNDLE, lock: "share" },
      { table: "intake_forms", id: INTAKE, lock: "share" },
    ]);
    expect(reads.every(read => read.handle === tx)).toBe(true);
    expect(reads.map(read => read.fields)).toEqual([
      ["id", "tenantId", "projectId"], ["id", "tenantId"], ["id", "tenantId", "projectId", "formData"],
    ]);
    expect(trace).toEqual(["begin", "read:estimates:share", "read:bundles:share", "read:intake_forms:share", "commit"]);
  });
  it("preserves all explicit nulls without a query", async () => {
    await expect(run(empty)).resolves.toBeUndefined();
    expect(reads).toEqual([]); expect(tx.select).not.toHaveBeenCalled();
  });
  it("accepts additional origin/context fields without reading or copying them", async () => {
    const extra = vi.fn(() => { throw new Error("Unconsumed metadata was read"); });
    const refs = Object.defineProperty({ ...origin }, "source", { get: extra });
    const auth = Object.defineProperty({ ...context }, "profile", { get: extra });
    await expect(run(refs, auth)).resolves.toBeUndefined();
    expect(extra).not.toHaveBeenCalled();
  });
  it.each(tableCases)("reads only the non-null %s reference", async (_name, table, key, reviewedId) => {
    await expect(run({ ...empty, [key]: reviewedId })).resolves.toBeUndefined();
    expect(reads).toHaveLength(1); expect(reads[0]).toMatchObject({ table: getTableName(table), id: reviewedId, lock: "share" });
  });
  it.each(tableCases)("does not substitute a same-project %s with another ID", async (_name, table) => {
    row(table).id = OTHER;
    await expectUnresolved();
  });
  it.each(tableCases)("rejects a missing %s", async (_name, table) => {
    storage.set(table, []); await expectUnresolved();
  });
  it.each(tableCases)("rejects a foreign-tenant %s even with a matching reviewed ID", async (_name, table) => {
    row(table).tenantId = OTHER; await expectUnresolved();
  });
  it.each(tableCases)("rejects a legacy-null-tenant %s", async (_name, table) => {
    row(table).tenantId = null; await expectUnresolved();
  });
  it.each([["estimate", estimates], ["intake", intakeForms]] as const)("rejects another project's %s", async (_name, table) => {
    row(table).projectId = OTHER; await expectUnresolved();
  });
  it("does not replace a physical null intake project with matching JSON", async () => {
    Object.assign(row(intakeForms), { projectId: null, formData: { projectId: PROJECT, clientId: CLIENT } });
    await expectUnresolved();
  });
  it("accepts an inactive bundle as provenance without consulting dates or prices", async () => {
    row(bundles).isActive = false;
    await expect(run()).resolves.toBeUndefined();
    expect(reads.map(read => read.table)).toEqual(["estimates", "bundles", "intake_forms"]);
  });
  it.each(["draft", "converted", "unrecognized-reference-only", ""])("does not make intake status %s an eligibility predicate", async status => {
    row(intakeForms).status = status;
    await expect(run()).resolves.toBeUndefined();
  });
  it.each(["approved", "archived", "unrecognized-reference-only"])("does not grant or refuse copying authority from estimate status %s", async status => {
    row(estimates).status = status;
    await expect(run()).resolves.toBeUndefined();
  });
  it("propagates a serialization failure without disguising it as missing provenance", async () => {
    const error = Object.assign(new Error("Synthetic retryable read"), { code: "40001" });
    readFailure = error;
    await expect(run()).rejects.toBe(error);
    expect(trace).toContain("rollback");
  });
});

describe("canonical identities and explicit null inputs", () => {
  const malformed = [undefined, nil, TENANT.toUpperCase(), "not-a-uuid", 1] as const;
  it.each(malformed)("rejects malformed reference %# before querying any table", async value => {
    await expectUnresolved({ ...origin, intakeFormId: value } as unknown as Origin);
    expect(reads).toEqual([]);
  });
  it.each(["estimateId", "bundleId", "intakeFormId"] as const)("does not infer a missing %s as null", async key => {
    const input: Partial<Origin> = { ...origin }; delete input[key];
    await expectUnresolved(input as Origin); expect(reads).toEqual([]);
  });
  it.each(["tenantId", "projectId", "clientId"] as const)("requires a valid non-null context %s even with no refs", async key => {
    await expectUnresolved(empty, { ...context, [key]: null } as unknown as Context);
    expect(reads).toEqual([]);
  });
  it.each(["00000000-0000-0000-0000-000000000001", "12345678-1234-f234-1234-123456789abc"])("accepts Core UUID %s without a version/variant restriction", async reviewedId => {
    row(estimates).id = reviewedId;
    await expect(run({ ...origin, estimateId: reviewedId })).resolves.toBeUndefined();
    expect(reads[0].id).toBe(reviewedId);
  });
  it("rejects an accessor input without invoking it", async () => {
    const getter = vi.fn(() => ESTIMATE);
    const refs = Object.defineProperty({ ...origin }, "estimateId", { get: getter });
    await expectUnresolved(refs); expect(getter).not.toHaveBeenCalled(); expect(reads).toEqual([]);
  });
  it("requires own fields rather than inherited reference IDs", async () => {
    await expectUnresolved(Object.create(origin) as Origin); expect(reads).toEqual([]);
  });
  it("rejects a context accessor without invoking it", async () => {
    const getter = vi.fn(() => CLIENT);
    const auth = Object.defineProperty({ ...context }, "clientId", { get: getter });
    await expectUnresolved(empty, auth); expect(getter).not.toHaveBeenCalled(); expect(reads).toEqual([]);
  });
  it("rejects uppercase authenticated identity before querying", async () => {
    await expectUnresolved(empty, { ...context, tenantId: TENANT.toUpperCase() });
    expect(reads).toEqual([]);
  });
});

describe("raw intake JSON identity claims", () => {
  it.each([null, {}, { clientId: null, projectId: null }, { clientId: CLIENT }, { projectId: PROJECT }, { clientId: CLIENT, projectId: PROJECT, notes: "kept only in the source" }])(
    "accepts absent/null or matching claims %# without copying the payload", async formData => {
      row(intakeForms).formData = formData; await expect(run()).resolves.toBeUndefined();
    }
  );
  it.each([undefined, [], "opaque", 3, true])("rejects non-object JSON root %#", async formData => {
    row(intakeForms).formData = formData; await expectUnresolved();
  });
  it.each(["clientId", "projectId"] as const)("rejects contradictory %s despite the matching physical project", async key => {
    row(intakeForms).formData = { [key]: OTHER }; await expectUnresolved();
  });
  it.each([undefined, "", 1, nil, CLIENT.toUpperCase()])("rejects malformed explicit client claim %#", async value => {
    row(intakeForms).formData = { clientId: value }; await expectUnresolved();
  });
  it("does not let matching metadata override a foreign physical tenant/project", async () => {
    Object.assign(row(intakeForms), { tenantId: OTHER, projectId: OTHER, formData: { tenantId: TENANT, projectId: PROJECT, clientId: CLIENT } });
    await expectUnresolved();
  });
});
