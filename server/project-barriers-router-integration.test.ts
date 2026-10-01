/**
 * Regressions exercising the REAL router (real Zod schemas), REAL project-db.ts helpers,
 * and REAL requireProjectAccess — only the true I/O boundary (getDb, logAudit, and the 3
 * external-network geo functions used below) is a fake driver/spy, same convention as
 * server/tenant-f5b-project-geo-callers.test.ts and server/estimate-status-approval-guard.
 * test.ts. This file exists specifically because server/project-router.test.ts mocks the
 * helpers entirely and therefore cannot see Zod silently stripping a forbidden key BEFORE
 * it ever reaches the barrier. Every test except the two V4 geo-boundary cases below sends
 * no address fields, so the geocode branch (validateAddressForGeocoding → isValid:false)
 * never fires for them — geo-geocoding's real, unmocked validateAddressForGeocoding is
 * exercised as-is; only geo-integration's 3 network-adjacent functions are spied, and only
 * the 2 V4 tests below ever supply an address eligible enough to reach that branch at all.
 *
 * V3 correction (Michael's V2 QA): V2's own "positive control" here asserted that
 * `project.update` could perform a formation transition ("estimating") through the
 * generic, write-permission-only route — that capability is EXACTLY the authority
 * escalation V3 closes (it let a "field" role, write but no approve, reach transitions the
 * dedicated approve-gated `project.updateStatus` correctly denies them). That test is
 * replaced below by its negation, plus a role-based matrix proving the dedicated route is
 * the only reachable path for a real transition, gated by "approve" as it always was.
 *
 * MOCKED-DB unit suite, not a physical Postgres proof — no real constraint enforcement,
 * locking under real concurrency, or RLS is exercised here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { TrpcContext } from "./_core/context";

const boundary = vi.hoisted(() => ({
  getDb: vi.fn(), audit: vi.fn(),
  geocodeAndDetectZone: vi.fn(), persistGeocodeResult: vi.fn(), refreshProjectGeocode: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: boundary.getDb }));
vi.mock("./audit", () => ({ logAudit: boundary.audit }));
// Only the 3 network-adjacent functions are replaced; geo-geocoding's real, local, pure
// validateAddressForGeocoding stays unmocked so eligibility is genuinely evaluated, not
// asserted by fiat.
vi.mock("./geo-integration", () => ({
  geocodeAndDetectZone: boundary.geocodeAndDetectZone,
  persistGeocodeResult: boundary.persistGeocodeResult,
  refreshProjectGeocode: boundary.refreshProjectGeocode,
}));

import { projectRouter } from "./project-router";

const TENANT = "c3200000-0000-4000-8000-000000000001";
const OTHER_TENANT = "c3200000-0000-4000-8000-000000000002";
const ACTOR = "c3200000-0000-4000-8000-000000000010"; // project owner — full permissions, including approve
const FIELD_ACTOR = "c3200000-0000-4000-8000-000000000011"; // project_members role "field": read+write, NO approve
const PROJECT = "c3200000-0000-4000-8000-000000000100";
const NOW = new Date("2026-09-30T12:00:00Z");

// The 11 operational/financial keys the barrier must recognize on BOTH create and update —
// 7 direct helper field names + 4 router-only alias names for the same governed data.
// approvedBudgetCents/changeOrderBudgetCents added per PROJECT-BUDGET-PAYLOAD-GUARDS-
// CONTRACT.md: both were previously absent from this list, so Zod silently stripped them —
// the same partial-success bug this suite already proves is closed for the other 9.
const OPERATIONAL_KEYS = [
  "estimatedTotal", "actualTotal", "variancePct", "startDate", "endDate",
  "estimatedValue", "actualCost", "grossProfit", "profitShieldMinPct",
  "approvedBudgetCents", "changeOrderBudgetCents",
] as const;

type Row = Record<string, unknown>;
const rows: Record<string, Row[]> = {};
const events: string[] = [];
let sequence = 0;

function camel(column: string): string {
  return column.replace(/_([a-z])/g, (_m, l: string) => l.toUpperCase());
}
function matching(table: Table, predicate: SQL | undefined): Row[] {
  const name = getTableName(table);
  if (!predicate) return rows[name] ?? [];
  const query = new PgDialect().sqlToQuery(predicate);
  const conditions = [...query.sql.matchAll(/"([a-z_]+)"\."([a-z_]+)" = \$(\d+)/g)];
  return (rows[name] ?? []).filter(row =>
    conditions.every(([, , column, position]) => row[camel(column)] === query.params[Number(position) - 1]),
  );
}

const driver: any = {
  select: (columns?: Record<string, any>) => ({
    from: (table: Table) => {
      let predicate: SQL | undefined;
      let maximum = Infinity;
      const q: any = {
        where: (value: SQL) => { predicate = value; return q; },
        limit: (value: number) => { maximum = value; return q; },
        for: () => q,
        then: (yes: any, no?: any) =>
          Promise.resolve()
            .then(() => {
              events.push(`read:${getTableName(table)}`);
              const selected = structuredClone(matching(table, predicate).slice(0, maximum));
              return columns
                ? selected.map((row: Row) =>
                    Object.fromEntries(Object.entries(columns).map(([key, col]: [string, any]) => [key, row[camel(col.name)]])),
                  )
                : selected;
            })
            .then(yes, no),
      };
      return q;
    },
  }),
  insert: (table: Table) => ({
    values: (value: Row) => ({
      returning: async (columns?: Record<string, any>) => {
        const name = getTableName(table);
        const id = `c3200000-0000-4000-8000-9${String(++sequence).padStart(11, "0")}`;
        const row = { deletedAt: null, ...structuredClone(value), id };
        (rows[name] ??= []).push(row);
        events.push(`insert:${name}`);
        return columns ? [{ id: row.id }] : [structuredClone(row)];
      },
    }),
  }),
  update: (table: Table) => ({
    set: (patch: Row) => ({
      where: (predicate: SQL) => {
        const write = async () => {
          const name = getTableName(table);
          events.push(`write:${name}`);
          const selected = matching(table, predicate);
          for (const row of selected) Object.assign(row, patch);
          return structuredClone(selected);
        };
        return { then: (yes: any, no?: any) => write().then(yes, no) };
      },
    }),
  }),
};
const db = {
  ...driver,
  transaction: async (work: (tx: any) => Promise<any>) => {
    const before = structuredClone(rows);
    try {
      return await work(driver);
    } catch (error) {
      for (const key of Object.keys(rows)) delete rows[key];
      Object.assign(rows, before);
      throw error;
    }
  },
};

function context(userId: string = ACTOR, tenantId: string = TENANT): TrpcContext {
  return {
    req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "legacy", tenantId,
    user: {
      id: userId, tenantId, role: "user", isActive: true, externalOpenId: null,
      email: "operator@example.invalid", fullName: "Synthetic Operator", companyName: null,
      loginMethod: "legacy", lastSignedIn: NOW, createdAt: NOW, updatedAt: NOW,
    } as any,
  };
}
const caller = (userId: string = ACTOR, tenantId: string = TENANT) => projectRouter.createCaller(context(userId, tenantId));

function expectNoWrites() {
  expect(events.filter(e => e.startsWith("write:") || e.startsWith("insert:"))).toEqual([]);
  expect(boundary.audit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  events.length = 0;
  for (const key of Object.keys(rows)) delete rows[key];
  rows.tenants = [{ id: TENANT, isActive: true }, { id: OTHER_TENANT, isActive: true }];
  rows.profiles = [
    { id: ACTOR, tenantId: TENANT, role: "user", isActive: true },
    { id: FIELD_ACTOR, tenantId: TENANT, role: "user", isActive: true },
  ];
  rows.projects = [{
    id: PROJECT, tenantId: TENANT, ownerUserId: ACTOR, deletedAt: null, status: "intake",
    name: "Synthetic Project", clientId: null, notes: null, address: null,
  }];
  // FIELD_ACTOR is a real project_members row with role "field": read+write, NO approve
  // (server/project-access.ts's PROJECT_ROLE_PERMISSIONS) — not the owner, so ownership
  // never substitutes for the permission being tested.
  rows.project_members = [
    { tenantId: TENANT, projectId: PROJECT, userId: FIELD_ACTOR, projectRole: "field", permissions: [], isActive: true },
  ];
  boundary.getDb.mockResolvedValue(db);
  boundary.audit.mockImplementation(async (params: any) => ({
    id: "audit-1", userId: params.userId, action: params.action, tableName: params.tableName,
    recordId: params.recordId, oldValues: params.before ?? null, newValues: params.after ?? null,
    createdAt: new Date(), ipAddress: null, userAgent: null,
  }));
});

describe("the public route must not let Zod silently strip a forbidden key", () => {
  it("project.update refuses a mixed payload WHOLESALE instead of silently applying only the legitimate field", async () => {
    // Michael's V1 finding 1, reproduced exactly: {notes, actualTotal: null} through the
    // real router. Pre-fix, actualTotal is absent from updateProjectSchema, so Zod strips
    // it before the handler runs — updateProject only ever sees {notes}, applies it, and
    // returns success. That is the bug: an attempted forbidden write silently "succeeds"
    // by having the forbidden part dropped, rather than the whole request being refused.
    const before = structuredClone(rows.projects[0]);
    await expect(caller().update({ id: PROJECT, data: { notes: "should not save", actualTotal: null } as any }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
  });

  it.each(OPERATIONAL_KEYS)("project.update refuses %s through the real router, value defined", async key => {
    await expect(caller().update({ id: PROJECT, data: { notes: "x", [key]: "9999.00" } as any }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expectNoWrites();
  });

  it.each(OPERATIONAL_KEYS)("project.update refuses %s through the real router, explicit null", async key => {
    await expect(caller().update({ id: PROJECT, data: { [key]: null } as any }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expectNoWrites();
  });

  it("project.create refuses an attempted status instead of silently creating with a default", async () => {
    // Michael's V1 finding 1, create illustration: {name, status:"approved"}. Pre-fix,
    // createProjectSchema has no status field, so Zod strips it — createProject receives
    // only {name}, and happily creates an "intake" project. The attempt to force approved
    // must be refused entirely, not silently downgraded to a default-status success.
    await expect(caller().create({ name: "New Project", status: "approved" } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it.each(OPERATIONAL_KEYS)("V3: project.create refuses %s through the real router, value defined — Michael's V2 finding 2", async key => {
    // V2 only added `status` to createProjectSchema; all 9 financial/operational keys were
    // still absent, so Zod stripped them here too — {name, actualTotal:null} silently
    // created a project. createProjectSchema now recognizes all 9 for the same reason
    // updateProjectSchema does: refuse the whole attempt, never apply, never drop silently.
    await expect(caller().create({ name: "New Project", projectType: "remodel", [key]: "9999.00" } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it.each(OPERATIONAL_KEYS)("V3: project.create refuses %s through the real router, explicit null", async key => {
    await expect(caller().create({ name: "New Project", projectType: "remodel", [key]: null } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
  });

  it("project.update: an absent status key is not a write and passes through — notes-only formation is unaffected", async () => {
    const result = await caller().update({ id: PROJECT, data: { notes: "site visit scheduled" } as any });
    expect(result.notes).toBe("site visit scheduled");
    expect(boundary.audit).toHaveBeenCalledTimes(1);
  });
});

describe("budget fields: PROJECT-BUDGET-PAYLOAD-GUARDS-CONTRACT.md — closing the silent-discard gap", () => {
  // 0 is a distinct edge case from the generic it.each above (which uses "9999.00"): a
  // naive implementation might treat a falsy-but-defined 0 as absent. Covered explicitly
  // for both fields, both routes, since the contract calls this out by name.
  it("project.update refuses approvedBudgetCents=0 (falsy but defined) through the real router", async () => {
    const before = structuredClone(rows.projects[0]);
    await expect(caller().update({ id: PROJECT, data: { notes: "x", approvedBudgetCents: 0 } as any }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
  });

  it("project.update refuses changeOrderBudgetCents=0 (falsy but defined) through the real router", async () => {
    await expect(caller().update({ id: PROJECT, data: { changeOrderBudgetCents: 0 } as any }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expectNoWrites();
  });

  it("project.create refuses approvedBudgetCents=0 through the real router", async () => {
    await expect(caller().create({ name: "New Project", projectType: "remodel", approvedBudgetCents: 0 } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it("project.create refuses changeOrderBudgetCents=0 through the real router", async () => {
    await expect(caller().create({ name: "New Project", projectType: "remodel", changeOrderBudgetCents: 0 } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
  });

  it("project.update refuses a mixed payload (notes + a realistic positive budget value) WHOLESALE — Jim's remaining-fields finding, reproduced exactly", async () => {
    // The exact scenario named in MICHAEL-PROJECT-REOPEN-REMAINING-FIELDS-RECONCILIATION.md:
    // the API discards the budget key and lets the rest of the same object's permitted
    // fields through. Pre-fix, approvedBudgetCents is absent from updateProjectSchema, so
    // Zod strips it — updateProject only ever sees {notes}, applies it, returns success.
    const before = structuredClone(rows.projects[0]);
    await expect(caller().update({ id: PROJECT, data: { notes: "should not save", approvedBudgetCents: 50000 } as any }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
  });

  it("project.create refuses a mixed payload (notes + changeOrderBudgetCents) WHOLESALE, not a silent default-budget create", async () => {
    await expect(caller().create({ name: "New Project", projectType: "remodel", notes: "should not save", changeOrderBudgetCents: 25000 } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
    expect(boundary.audit).not.toHaveBeenCalled();
  });

  it("project.update: legitimate absence of BOTH budget keys is unaffected — notes-only update still succeeds", async () => {
    const result = await caller().update({ id: PROJECT, data: { notes: "budget untouched" } as any });
    expect(result.notes).toBe("budget untouched");
    expect(boundary.audit).toHaveBeenCalledTimes(1);
  });
});

describe("V3: project.update no longer accepts ANY status — formation belongs only to the dedicated, approve-gated route", () => {
  it('refuses a LEGITIMATE formation status ("estimating") through the generic write-permission route, not just the 4 forbidden ones', async () => {
    // This is the negation of V2's own (incorrect) positive control: V2 let this succeed,
    // which meant "write" permission alone (not "approve") could perform a real state
    // transition through project.update — exactly the escalation Michael's V2 QA found.
    const before = structuredClone(rows.projects[0]);
    await expect(caller().update({ id: PROJECT, data: { status: "estimating" } as any }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
  });

  it("a mixed payload with a legitimate status and a legitimate note is STILL refused wholesale — no partial notes save", async () => {
    const before = structuredClone(rows.projects[0]);
    await expect(caller().update({ id: PROJECT, data: { notes: "should not save either", status: "cancelled" } as any }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
  });
});

describe("V3: role matrix — write (no approve) vs approve, across the generic route and the dedicated route", () => {
  it("FIELD_ACTOR (write, no approve): notes pass through project.update", async () => {
    const result = await caller(FIELD_ACTOR).update({ id: PROJECT, data: { notes: "field note" } as any });
    expect(result.notes).toBe("field note");
  });

  it("FIELD_ACTOR (write, no approve): a status attempt via project.update is refused by the barrier, same as anyone else's", async () => {
    await expect(caller(FIELD_ACTOR).update({ id: PROJECT, data: { status: "estimating" } as any }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expectNoWrites();
  });

  it("FIELD_ACTOR (write, no approve): project.updateStatus is refused at the ACL layer — never reaches the barrier at all", async () => {
    await expect(caller(FIELD_ACTOR).updateStatus({ id: PROJECT, status: "estimating" } as any))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoWrites();
  });

  it("ACTOR (owner — has approve): project.updateStatus performs the real formation transition — the ONLY reachable path for it", async () => {
    const result = await caller(ACTOR).updateStatus({ id: PROJECT, status: "estimating" } as any);
    expect(result.status).toBe("estimating");
    expect(boundary.audit).toHaveBeenCalledTimes(1);
  });
});

describe("updateStatus must authorize BEFORE judging a forbidden destination, and classify correctly after", () => {
  it('an unauthorized caller requesting "closed" gets the ACL error, not a format error that reveals the rule first', async () => {
    await expect(caller(ACTOR, OTHER_TENANT).updateStatus({ id: PROJECT, status: "closed" } as any))
      .rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND/) });
    expectNoWrites();
  });

  it('an authorized caller requesting "closed" is refused by the operational barrier (PRECONDITION_FAILED), proving the value DID reach the resolver', async () => {
    await expect(caller().updateStatus({ id: PROJECT, status: "closed" } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(events).toContain("read:projects"); // requireProjectAccess's own project read ran
    expectNoWrites();
  });

  it("V3: a genuinely unrecognized status is BAD_REQUEST after authorization, not INTERNAL_SERVER_ERROR", async () => {
    // V2 let a plain, un-typed Error escape from assertValidStatusTransition, which tRPC's
    // default formatter turns into INTERNAL_SERVER_ERROR — an implementation detail leak,
    // not the intended classification. A value that is neither one of the 4 forbidden
    // destinations nor a legal transition target is a client input problem (BAD_REQUEST),
    // and it is still only classified this way AFTER requireProjectAccess has already run.
    await expect(caller().updateStatus({ id: PROJECT, status: "not_a_real_status" } as any))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(events).toContain("read:projects");
    expectNoWrites();
  });
});

describe("V4: a geocode-eligible address in a refused payload must not reach any network-adjacent boundary", () => {
  // 100 Main St / Charleston / SC / 29401 supplies all 4 address components — well past
  // MIN_ADDRESS_COMPONENTS (2, geo-geocoding.ts:30) — so validateAddressForGeocoding (real,
  // unmocked) genuinely evaluates isValid:true here; this is not asserted by fiat. Only
  // geo-integration's 3 network-adjacent functions are spied (see the top of this file).
  const eligibleAddress = { address: "100 Main St", city: "Charleston", state: "SC", zip: "29401" };

  it("project.create: a refused payload with an eligible address never calls geocodeAndDetectZone/persistGeocodeResult", async () => {
    await expect(caller().create({ name: "New Project", projectType: "remodel", ...eligibleAddress, actualTotal: "500" } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(events.filter(e => e.startsWith("insert:"))).toEqual([]);
    expect(boundary.audit).not.toHaveBeenCalled();
    expect(boundary.geocodeAndDetectZone).not.toHaveBeenCalled();
    expect(boundary.persistGeocodeResult).not.toHaveBeenCalled();
  });

  it("project.update: a refused payload with an eligible address never calls refreshProjectGeocode", async () => {
    const before = structuredClone(rows.projects[0]);
    await expect(caller().update({ id: PROJECT, data: { ...eligibleAddress, actualTotal: "500" } as any }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
    expect(boundary.refreshProjectGeocode).not.toHaveBeenCalled();
  });
});

describe("project-cancel-20260930: project.delete through the real router", () => {
  it("cancels an in_progress project as the owner", async () => {
    rows.projects[0].status = "in_progress";
    const result = await caller().delete({ id: PROJECT });
    expect(result).toEqual({ success: true });
    expect(rows.projects[0].status).toBe("cancelled");
    expect(boundary.audit).toHaveBeenCalledTimes(1);
  });

  it("refuses to cancel a completed project via the real router — BAD_REQUEST, no mutation", async () => {
    rows.projects[0].status = "completed";
    const before = structuredClone(rows.projects[0]);
    await expect(caller().delete({ id: PROJECT })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
  });

  it("cancelling an already-cancelled project via the real router succeeds with no new mutation or audit event", async () => {
    rows.projects[0].status = "cancelled";
    const before = structuredClone(rows.projects[0]);
    const result = await caller().delete({ id: PROJECT });
    expect(result).toEqual({ success: true });
    expect(rows.projects[0]).toEqual(before);
    expectNoWrites();
  });

  it("FIELD_ACTOR (read+write, no delete) is refused before any state is judged", async () => {
    rows.projects[0].status = "completed"; // would ALSO fail the transition check — ACL wins first
    await expect(caller(FIELD_ACTOR).delete({ id: PROJECT })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoWrites();
  });

  it("an unresolved tenant context never reaches the helper", async () => {
    await expect(caller(ACTOR, null as any).delete({ id: PROJECT })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoWrites();
  });
});
