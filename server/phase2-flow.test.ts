/**
 * PHASE 2 — Full-cycle flow tests (mocked persistence)
 *
 * Exercises the gates that close the pre-visit → estimate cycle, at the layer where the
 * decision is actually enforced:
 *
 *   A. lead → client → project conversion (minimum data, dedupe, tenant, idempotency)
 *   B. pre-visit persistence gate (evidence, checklist, completion readiness)
 *   C. estimate approval gate (Profit Shield by channel, version lock)
 *   D. estimate versioning and change orders
 *   E. JobTread export gate (authorization, validation, reconciliation, download)
 *
 * The database is stubbed with an in-memory table set, so the tests assert the actual
 * control flow of the server modules rather than the source text.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ══════════════════════════════════════════════════════════════════════
// IN-MEMORY DB STUB
// ══════════════════════════════════════════════════════════════════════

type Row = Record<string, unknown>;

interface TableStore {
  tenants: Row[];
  profiles: Row[];
  estimate_internal_approval_snapshots: Row[];
  estimate_internal_approvals: Row[];
  leads: Row[];
  clients: Row[];
  projects: Row[];
  intake_forms: Row[];
  lead_activities: Row[];
  deals: Row[];
  // Empty by default — enough for requireProjectAccess's membership/RBAC fallthrough to
  // resolve to "no grant found" (not a crash) when a replay test needs a genuine ACL
  // denial rather than an owner match.
  project_members: Row[];
  users: Row[];
  roles: Row[];
  previsit_briefs: Row[];
  previsit_checklist_items: Row[];
  estimate_drafts: Row[];
  historical_estimate_imports: Row[];
  jobtread_exports: Row[];
  scope_drafts: Row[];
  // Not a real drizzle table — a capture of what logAudit actually wrote, so tests can
  // assert an event's disappearance on rollback, not just that the call was made.
  audit_events: Row[];
}

const store: TableStore = {
  tenants: [],
  profiles: [],
  estimate_internal_approval_snapshots: [],
  estimate_internal_approvals: [],
  leads: [],
  clients: [],
  projects: [],
  intake_forms: [],
  lead_activities: [],
  deals: [],
  project_members: [],
  users: [],
  roles: [],
  previsit_briefs: [],
  previsit_checklist_items: [],
  estimate_drafts: [],
  historical_estimate_imports: [],
  jobtread_exports: [],
  scope_drafts: [],
  audit_events: [],
};

/**
 * Predicates are captured as closures by the drizzle stub. Rather than interpreting SQL,
 * the stub records the last table touched and applies the filter callbacks registered by
 * `whereMatcher`, which the tests configure per scenario. In practice the modules under
 * test filter by a single id, so matching on any `id`-like value in the condition is
 * sufficient and keeps the stub honest about "which row would the DB return".
 */
let conditionValues: unknown[] = [];
/** A queue of one-shot hooks: each `FOR UPDATE` lock acquisition shifts and fires the
 * next one — see makeSelectBuilder's `for()`. A single transaction can take more than one
 * such lock (the lead, then later a reused client), so a test that needs to interfere with
 * the SECOND one queues a no-op for the first. Reset in resetStore() between tests. */
let onLockAcquireQueue: Array<() => void> = [];

function captureValues(condition: unknown): unknown[] {
  const values: unknown[] = [];
  const walk = (node: unknown, depth = 0) => {
    if (node == null || depth > 8) return;
    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
      values.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child, depth + 1);
      return;
    }
    if (typeof node === "object") {
      // A drizzle Column carries its whole parent table (constraint names, defaults, other
      // columns' metadata) — booleans/strings that pollute the captured value set and make
      // `matches()` below match rows it has no business matching whenever a condition is
      // built against a table with more than one candidate row of that primitive type. A
      // Column is never itself the comparison value (the query's Param chunk is), so
      // recognize and skip it by its `columnType` field instead of recursing into it.
      if ("columnType" in (node as Row) && "table" in (node as Row)) return;
      for (const child of Object.values(node as Row)) walk(child, depth + 1);
    }
  };
  walk(condition);
  return values;
}

function tableKey(table: unknown): keyof TableStore {
  // drizzle tables expose their SQL name through a well-known symbol; fall back to a
  // best-effort read of common shapes so the stub does not depend on drizzle internals.
  const anyTable = table as Record<string | symbol, unknown>;
  for (const sym of Object.getOwnPropertySymbols(anyTable)) {
    const value = anyTable[sym];
    if (typeof value === "string" && value in store) return value as keyof TableStore;
  }
  const name = (anyTable["_"] as Row | undefined)?.name;
  if (typeof name === "string" && name in store) return name as keyof TableStore;
  throw new Error("Unknown table in DB stub");
}

function matches(row: Row): boolean {
  if (conditionValues.length === 0) return true;
  // A row matches when every string/number value in the condition that looks like an id
  // or status is present somewhere on the row.
  const rowValues = new Set(
    Object.values(row).map((v) => (v instanceof Date ? v.toISOString() : v)),
  );
  const relevant = conditionValues.filter(
    (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
  );
  if (relevant.length === 0) return true;
  return relevant.some((v) => rowValues.has(v as never));
}

function makeSelectBuilder(rows: Row[], maximum = Infinity) {
  const builder: Record<string, unknown> = {};
  const result = () => structuredClone(rows.filter(matches).slice(0, maximum));
  Object.assign(builder, {
    from: (table: unknown) => {
      const key = tableKey(table);
      return makeSelectBuilder(store[key]);
    },
    where: (condition: unknown) => {
      conditionValues = captureValues(condition);
      return makeSelectBuilder(rows);
    },
    orderBy: () => makeSelectBuilder(rows),
    limit: (n: number) => makeSelectBuilder(rows, n),
    // Each `FOR UPDATE` lock acquisition shifts and fires the next queued hook — this is
    // how tests inject a deterministic mid-flight change (revoked actor, a client that
    // becomes ineligible between candidate-loading and its own lock) exactly when a
    // specific lock is taken, instead of only ever seeding an already-invalid state.
    for: (mode?: string) => {
      if (mode === "update" && onLockAcquireQueue.length > 0) {
        const fn = onLockAcquireQueue.shift()!;
        fn();
      }
      return makeSelectBuilder(rows, maximum);
    },
    then: (resolve: (v: Row[]) => unknown) => Promise.resolve(result()).then(resolve),
  });
  return builder as never;
}

function makeDb() {
  const db = {
    select: (_columns?: unknown) => {
      conditionValues = [];
      return makeSelectBuilder([]);
    },
    insert: (table: unknown) => {
      const key = tableKey(table);
      return {
        values: (payload: Row | Row[]) => {
          const rows = Array.isArray(payload) ? payload : [payload];
          const inserted = rows.map((r) => ({
            id: r.id ?? `${key}-${store[key].length + 1}`,
            createdAt: r.createdAt ?? new Date(),
            updatedAt: r.updatedAt ?? new Date(),
            ...r,
          }));
          store[key].push(...inserted);
          return {
            returning: (_cols?: unknown) => Promise.resolve(inserted),
            then: (resolve: (v: Row[]) => unknown) => Promise.resolve(inserted).then(resolve),
          };
        },
      };
    },
    update: (table: unknown) => {
      const key = tableKey(table);
      return {
        set: (patch: Row) => ({
          where: (condition: unknown) => {
            conditionValues = captureValues(condition);
            const targets = store[key].filter(matches);
            for (const row of targets) Object.assign(row, patch);
            return Object.assign(Promise.resolve(structuredClone(targets)), { returning: async () => structuredClone(targets) });
          },
        }),
      };
    },
    // A real transaction rolls back every write it made when its callback throws — the
    // audit-atomicity behavior under test is meaningless against a stub that keeps
    // whatever was already pushed to `store` before the failure. Snapshot every table
    // before running the callback and restore on throw, so "nothing persisted after a
    // failed audit" is an honest assertion, not a assumption about a real database.
    //
    // The callback receives a DIFFERENT object identity than the pool (`Object.create(db)`
    // — inherits every method via the prototype chain, since none of them use `this`, so
    // behavior is unchanged) so a caller that accidentally audited on the pool connection
    // instead of the transaction handle would be distinguishable, not indistinguishable
    // from correct usage.
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      const snapshot: Partial<TableStore> = {};
      for (const key of Object.keys(store) as (keyof TableStore)[]) {
        snapshot[key] = structuredClone(store[key]) as never;
      }
      const tx = Object.create(db);
      lastTxHandle = tx;
      try {
        return await fn(tx);
      } catch (err) {
        for (const key of Object.keys(store) as (keyof TableStore)[]) {
          store[key] = snapshot[key] as never;
        }
        throw err;
      }
    },
    execute: async () => [],
  };
  return db;
}

let dbAvailable = true;
let lastPoolHandle: unknown = null;
let lastTxHandle: unknown = null;

vi.mock("./db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getDb: vi.fn(async () => {
      if (!dbAvailable) return null;
      const db = makeDb() as never;
      lastPoolHandle = db;
      return db;
    }),
    createEstimateDraft: vi.fn(),
  };
});

vi.mock("./audit", () => ({
  // Records the event into `store.audit_events` (subject to the same transaction
  // snapshot/restore as every other table) and captures the handle it was called with, so
  // tests can assert both "the event disappeared on rollback" and "it used the tx, not
  // the pool" — not just that logAudit was called.
  logAudit: vi.fn(async (params: any, handle: unknown) => {
    const row = {
      __handle: handle,
      id: `audit-event-${store.audit_events.length + 1}`,
      userId: params.userId,
      action: params.action,
      tableName: params.tableName,
      recordId: params.recordId,
      oldValues: params.before ?? null,
      newValues: params.after ?? null,
      createdAt: new Date("2026-09-20T00:00:00.000Z"),
      ipAddress: null,
      userAgent: null,
    };
    store.audit_events.push(row);
    return row;
  }),
}));

vi.mock("./geo-integration", () => ({
  refreshProjectGeocode: vi.fn(async () => ({
    geocode: {
      success: true,
      confidence: "high",
      withinServiceRadius: true,
      distanceFromCenter: 8.2,
    },
    zoneSnapshot: {
      zoneName: "Isle of Palms",
      coastalExposureLevel: "extreme",
      logisticsModifier: 1.22,
      minProfitShieldPct: 50,
    },
    zoneDetection: null,
    warnings: [],
  })),
}));

// ── Modules under test (imported after the mocks) ─────────────────────
import {
  convertLeadToProject,
  LeadConversionError,
  planLeadConversion,
  resolveProjectGeoContext,
  untenantedCandidatesAllowed,
} from "./lead-conversion";
import { logAudit } from "./audit";
import { refreshProjectGeocode } from "./geo-integration";
import {
  approveEstimateDraft,
  applyEstimateDraftDiscount,
  assertEstimateMutable,
  EstimateGuardError,
  evaluateDraftProfitShield,
} from "./estimate-db";
import { LegacyEstimateOperationError } from "@shared/estimate-legacy-hold";
import { buildExportManifest, reconcileExport } from "@shared/jobtread-reconciliation";
import { generateCsvString, type JobTreadCsvRow } from "./jobtread-csv-export";
import { createChangeOrder, createEstimateVersion, getExportableEstimate, getVersionChain } from "./estimate-version-db";
import {
  checkExportAuthorization,
  downloadJobTreadExport,
  requestJobTreadExport,
} from "./jobtread-export-db";

// ══════════════════════════════════════════════════════════════════════
// FIXTURES
// ══════════════════════════════════════════════════════════════════════

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const APPROVER = "33333333-3333-4333-8333-333333333333";

function resetStore() {
  store.tenants = [];
  store.profiles = [];
  store.estimate_internal_approval_snapshots = [];
  store.estimate_internal_approvals = [];
  store.leads = [];
  store.clients = [];
  store.projects = [];
  store.intake_forms = [];
  store.lead_activities = [];
  store.deals = [];
  store.project_members = [];
  store.users = [];
  store.roles = [];
  store.previsit_briefs = [];
  store.previsit_checklist_items = [];
  store.estimate_drafts = [];
  store.historical_estimate_imports = [];
  store.jobtread_exports = [];
  store.scope_drafts = [];
  store.audit_events = [];
  conditionValues = [];
  dbAvailable = true;
  lastTxHandle = null;
  onLockAcquireQueue = [];
}

/** Default valid actor for Group A's lead-conversion tests — convertLeadToProject now
 * revalidates the actor fresh from `profiles` on every call. Tests that need a specific
 * actor scenario (inactive, wrong tenant, admin) seed their own row before seedLead() and
 * this default is skipped, so it never overwrites a deliberately-configured one. */
function seedActor(overrides: Row = {}): Row {
  const actor: Row = { id: USER, tenantId: TENANT, isActive: true, role: "member", ...overrides };
  store.profiles.push(actor);
  return actor;
}

function seedLead(overrides: Row = {}): Row {
  if (!store.profiles.some((p) => p.id === USER)) seedActor();
  const lead: Row = {
    id: "lead-1",
    tenantId: TENANT,
    name: "Sarah Whitfield",
    email: "sarah.whitfield@example.com",
    phone: "8435550142",
    address: "412 Palmetto Street",
    city: "Charleston",
    state: "SC",
    zip: "29403",
    projectType: "remodel",
    serviceType: null,
    clientType: "homeowner",
    commercialChannel: null,
    sourceChannel: "referral",
    source: "referral",
    sourceDetail: null,
    nextStep: "schedule_previsit",
    ownerUserId: USER,
    status: "qualified",
    convertedClientId: null,
    convertedProjectId: null,
    ...overrides,
  };
  store.leads.push(lead);
  return lead;
}

const MUTATION_DRAFT = "88000000-0000-4000-8000-000000000002";
const MUTATION_PROJECT = "88000000-0000-4000-8000-000000000003";
function seedMutableEstimate(overrides: Row = {}): Row {
  store.tenants.push({ id: TENANT, isActive: true });
  store.profiles.push({ id: USER, tenantId: TENANT, role: "admin", isActive: true });
  store.projects.push({ id: MUTATION_PROJECT, tenantId: TENANT, ownerUserId: USER, clientId: null, deletedAt: null });
  return seedEstimate({ id: MUTATION_DRAFT, projectId: MUTATION_PROJECT, clientId: null, ...overrides });
}

function seedEstimate(overrides: Row = {}): Row {
  const draft: Row = {
    id: "est-1",
    tenantId: TENANT,
    projectId: "project-1",
    scopeDraftId: "scope-1",
    status: "draft",
    source: "scope_draft",
    version: 1,
    supersedesId: null,
    supersededBy: null,
    changeOrderOf: null,
    changeOrderReason: null,
    bundleName: "Kitchen Remodel — Premium",
    channel: "direct",
    commercialChannel: "premium",
    region: "Charleston",
    finishLevel: "premium",
    zone: "West Ashley",
    lineItems: [
      {
        costItemId: "CI-001",
        costItemName: "Hardwood Flooring - Oak",
        costGroupName: "Interior Finishes",
        description: "Solid oak flooring",
        unit: "SF",
        quantity: 100,
        unitCostSnapshot: 4.5,
        unitPriceSnapshot: 10,
        lineTotalCost: 450,
        lineTotalPrice: 1000,
        grossProfitPct: 55,
        costCode: "09-000",
      },
    ],
    assemblySelections: [],
    subtotalCost: "450.00",
    subtotalPrice: "1000.00",
    grossProfit: "550.00",
    grossProfitPct: "55.00",
    discountApplied: null,
    discountAmount: null,
    finalTotalPrice: "1000.00",
    profitShieldFloorPct: null,
    profitShieldEvaluation: null,
    pricingSnapshot: { commercialChannel: "premium", zone: "West Ashley", geoRiskClass: "inland" },
    pricingSchemaVersion: "1.0",
    draftData: { grossProfitPct: 55 },
    notes: null,
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    lockedAt: null,
    createdBy: USER,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    updatedAt: new Date("2026-08-01T10:00:00Z"),
    ...overrides,
  };
  store.estimate_drafts.push(draft);
  return draft;
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════
// GROUP A — LEAD → CLIENT → PROJECT
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 2 flow — Group A: lead → client → project", () => {
  it("A1: a complete lead creates client, project and intake form in one transaction", async () => {
    seedLead();

    const result = await convertLeadToProject({
      leadId: "lead-1",
      tenantId: TENANT,
      userId: USER,
      resolveGeo: false,
    });

    expect(result.created).toBe(true);
    expect(result.clientId).toBeTruthy();
    expect(result.projectId).toBeTruthy();
    expect(result.intakeFormId).toBeTruthy();
    expect(store.clients).toHaveLength(1);
    expect(store.projects).toHaveLength(1);
    expect(store.intake_forms).toHaveLength(1);
  });

  it("A2: every created entity is stamped with the caller tenant (LIG-001)", async () => {
    seedLead();
    await convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false });

    expect(store.clients[0].tenantId).toBe(TENANT);
    expect(store.projects[0].tenantId).toBe(TENANT);
    expect(store.intake_forms[0].tenantId).toBe(TENANT);
  });

  it("A3: the project carries the commercial channel and the normalized address", async () => {
    seedLead();
    await convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false });

    expect(store.projects[0].commercialChannel).toBe("premium");
    expect(store.projects[0].clientType).toBe("homeowner");
    expect(store.projects[0].addressNormalized).toBe("412 palmetto st");
    expect(store.projects[0].status).toBe("intake");
    expect(store.projects[0].channel).toBe("direct");
  });

  it("A4: the lead is marked converted with both identifiers", async () => {
    seedLead();
    const result = await convertLeadToProject({
      leadId: "lead-1",
      tenantId: TENANT,
      userId: USER,
      resolveGeo: false,
    });

    expect(store.leads[0].status).toBe("converted");
    expect(store.leads[0].convertedProjectId).toBe(result.projectId);
    expect(store.leads[0].convertedClientId).toBe(result.clientId);
  });

  it("A5: missing minimum data blocks the write and creates nothing (LIG-007)", async () => {
    seedLead({ projectType: null, serviceType: null });

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "MINIMUM_DATA_MISSING" });

    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
  });

  it("A6: the operator can supply the missing minimum data as overrides", async () => {
    seedLead({ projectType: null, serviceType: null });

    const result = await convertLeadToProject({
      leadId: "lead-1",
      tenantId: TENANT,
      userId: USER,
      resolveGeo: false,
      overrides: { projectType: "remodel" },
    });

    expect(result.created).toBe(true);
    expect(store.projects[0].projectType).toBe("remodel");
  });

  it("A7: an already converted lead returns existing ids instead of duplicating (idempotent)", async () => {
    // The marker alone is no longer sufficient (identity/replay hardening) — a real
    // project/client backing it is required for the replay to verify and return it.
    store.clients.push({ id: "client-existing", tenantId: TENANT, isActive: true, deletedAt: null });
    store.projects.push({ id: "project-existing", tenantId: TENANT, leadId: "lead-1", clientId: "client-existing", deletedAt: null, ownerUserId: USER });
    seedLead({ convertedClientId: "client-existing", convertedProjectId: "project-existing" });

    const result = await convertLeadToProject({
      leadId: "lead-1",
      tenantId: TENANT,
      userId: USER,
      resolveGeo: false,
    });

    expect(result.created).toBe(false);
    expect(result.projectId).toBe("project-existing");
    expect(result.clientId).toBe("client-existing");
    expect(store.projects).toHaveLength(1); // the pre-existing one — no NEW project created
    expect(result.warnings.join(" ")).toMatch(/already converted/i);
  });

  it("A8: a lead from another tenant is refused", async () => {
    seedLead({ tenantId: "99999999-9999-4999-8999-999999999999" });

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
  });

  it("A9: an unknown lead raises LEAD_NOT_FOUND", async () => {
    await expect(
      convertLeadToProject({ leadId: "nope", tenantId: TENANT, userId: USER }),
    ).rejects.toBeInstanceOf(LeadConversionError);
  });

  it("A10: planLeadConversion is read-only", async () => {
    seedLead();
    const plan = await planLeadConversion({ leadId: "lead-1", tenantId: TENANT, userId: USER });

    expect(plan.decision).toBe("convert");
    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
  });

  it("A11: a dry run reports the decision without writing", async () => {
    seedLead();
    const result = await convertLeadToProject({
      leadId: "lead-1",
      tenantId: TENANT,
      userId: USER,
      dryRun: true,
    });

    expect(result.created).toBe(false);
    expect(store.projects).toHaveLength(0);
  });

  it("A12: an unavailable database fails closed", async () => {
    dbAvailable = false;
    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER }),
    ).rejects.toMatchObject({ code: "DB_UNAVAILABLE" });
  });

  it("A13: geo context resolution persists risk class and warning codes on the project", async () => {
    store.projects.push({ id: "project-1", tenantId: TENANT, deletedAt: null });

    // G3a-1: resolveProjectGeoContext now requires the caller's trusted tenant as its
    // first argument, so the zone lookup behind it is scoped to that tenant.
    const summary = await resolveProjectGeoContext(TENANT, "project-1", USER);

    expect(summary.riskClass).toBe("barrier_island");
    expect(summary.codes).toContain("geo.barrier_island_exposure");
    expect(summary.codes).toContain("geo.high_cost_multiplier");
    expect(store.projects[0].geoRiskClass).toBe("barrier_island");
    expect(Array.isArray(store.projects[0].geoWarnings)).toBe(true);
  });

  it("A14: conversion resolves geo automatically when not disabled", async () => {
    seedLead();
    const result = await convertLeadToProject({
      leadId: "lead-1",
      tenantId: TENANT,
      userId: USER,
    });

    expect(result.geoContext).not.toBeNull();
    expect(result.geoContext?.riskClass).toBe("barrier_island");
    expect(result.warnings.some((w) => w.includes("geo.barrier_island_exposure"))).toBe(true);
  });

  // ── Legacy rows without tenant_id (LIG-001) ─────────────────────────
  // A row with tenant_id IS NULL is only unambiguously the caller's while the deployment
  // holds at most one tenant. Beyond that it may only block a conversion, never be reused.

  it("A15: a single-tenant deployment still treats legacy rows as its own", async () => {
    store.tenants.push({ id: TENANT, name: "GCHI" });

    expect(await untenantedCandidatesAllowed(makeDb() as never)).toBe(true);
  });

  it("A16: once a second tenant exists, legacy rows are no longer reusable", async () => {
    store.tenants.push({ id: TENANT, name: "GCHI" });
    store.tenants.push({ id: "44444444-4444-4444-8444-444444444444", name: "Other" });

    expect(await untenantedCandidatesAllowed(makeDb() as never)).toBe(false);
  });

  it("A17: TENANT_STRICT switches the legacy tolerance off", async () => {
    const previous = process.env.TENANT_STRICT;
    process.env.TENANT_STRICT = "true";
    store.tenants.push({ id: TENANT, name: "GCHI" });

    try {
      expect(await untenantedCandidatesAllowed(makeDb() as never)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.TENANT_STRICT;
      else process.env.TENANT_STRICT = previous;
    }
  });

  it("A18: a failing tenant probe fails closed", async () => {
    const brokenDb = {
      select: () => {
        throw new Error("tenants unavailable");
      },
    };

    expect(await untenantedCandidatesAllowed(brokenDb as never)).toBe(false);
  });

  it("A19: reusing a client of the caller's own tenant is unaffected by several tenants", async () => {
    store.tenants.push({ id: TENANT, name: "GCHI" });
    store.tenants.push({ id: "44444444-4444-4444-8444-444444444444", name: "Other" });
    store.clients.push({
      id: "client-own",
      tenantId: TENANT,
      name: "Sarah Whitfield",
      email: "sarah.whitfield@example.com",
      phone: "8435550142",
      address: "412 Palmetto Street",
      city: "Charleston",
      state: "SC",
      zip: "29403",
      deletedAt: null,
      isActive: true,
    });
    seedLead();

    const result = await convertLeadToProject({
      leadId: "lead-1",
      tenantId: TENANT,
      userId: USER,
      resolveGeo: false,
    });

    expect(result.plan.decision).toBe("reuse_client");
    expect(result.clientId).toBe("client-own");
    expect(result.clientReused).toBe(true);
    expect(store.clients).toHaveLength(1);
  });

  it("A20: the lead.converted audit runs on the TX handle, distinct from the pool, once, on success", async () => {
    seedLead();
    await convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false });

    const convertedCalls = (logAudit as any).mock.calls.filter(
      (c: any[]) => c[0].action === "lead.converted",
    );
    expect(convertedCalls).toHaveLength(1);
    expect(convertedCalls[0][0].tableName).toBe("projects");
    expect(convertedCalls[0][1]).toBe(lastTxHandle);
    expect(convertedCalls[0][1]).not.toBe(lastPoolHandle);
    expect(store.audit_events).toHaveLength(1);
  });

  it("A21a: a REJECTED (thrown) lead.converted audit rolls back the whole conversion — nothing persisted, no geo, no orphan event", async () => {
    seedLead();
    (logAudit as any).mockRejectedValueOnce(new Error("audit connection lost"));

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER }),
    ).rejects.toThrow("audit connection lost");

    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
    expect(store.intake_forms).toHaveLength(0);
    expect(store.lead_activities).toHaveLength(0);
    expect(store.audit_events).toHaveLength(0);
    expect(store.leads[0].status).not.toBe("converted");
    expect(store.leads[0].convertedProjectId).toBeNull();
    expect(refreshProjectGeocode).not.toHaveBeenCalled();
  });

  it("A21b: a NULL-returning lead.converted audit rolls back the whole conversion — same effect via the return-value check, not the try/catch", async () => {
    seedLead();
    (logAudit as any).mockResolvedValueOnce(null);

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER }),
    ).rejects.toThrow(/audit insert failed/i);

    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
    expect(store.intake_forms).toHaveLength(0);
    expect(store.lead_activities).toHaveLength(0);
    expect(store.audit_events).toHaveLength(0);
    expect(store.leads[0].status).not.toBe("converted");
    expect(store.leads[0].convertedProjectId).toBeNull();
    expect(refreshProjectGeocode).not.toHaveBeenCalled();
  });

  it("A22: an already-converted lead's idempotent return does not emit a new audit event", async () => {
    store.clients.push({ id: "client-existing", tenantId: TENANT, isActive: true, deletedAt: null });
    store.projects.push({ id: "project-existing", tenantId: TENANT, leadId: "lead-1", clientId: "client-existing", deletedAt: null, ownerUserId: USER });
    seedLead({ convertedClientId: "client-existing", convertedProjectId: "project-existing" });
    await convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false });

    expect(logAudit).not.toHaveBeenCalled();
  });

  it("A23: a dry run does not write or audit", async () => {
    seedLead();
    await convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, dryRun: true });

    expect(logAudit).not.toHaveBeenCalled();
  });

  it("A24a: a MINIMUM_DATA_MISSING conversion persists the decision and its audit together, on the tx handle, before the typed refusal is thrown", async () => {
    seedLead({ projectType: null, serviceType: null });

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "MINIMUM_DATA_MISSING" });

    expect(store.leads[0].conversionDecision).toBe("blocked_minimum_data");
    const blockedCalls = (logAudit as any).mock.calls.filter(
      (c: any[]) => c[0].action === "lead.conversion_blocked",
    );
    expect(blockedCalls).toHaveLength(1);
    expect(blockedCalls[0][1]).toBe(lastTxHandle);
    expect(blockedCalls[0][1]).not.toBe(lastPoolHandle);
    expect(store.audit_events).toHaveLength(1);
  });

  it("A24b: a NEEDS_REVIEW conversion (duplicate project at the same address+type) also persists the decision and its audit together, before the typed refusal", async () => {
    seedLead();
    store.projects.push({
      id: "project-existing-dup",
      tenantId: TENANT,
      address: "412 Palmetto Street",
      projectType: "remodel",
      status: "in_progress",
      deletedAt: null,
      clientId: null,
    });

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "NEEDS_REVIEW" });

    expect(store.leads[0].conversionDecision).toBe("needs_review");
    const blockedCalls = (logAudit as any).mock.calls.filter(
      (c: any[]) => c[0].action === "lead.conversion_blocked",
    );
    expect(blockedCalls).toHaveLength(1);
    // Only the decision-write project should exist — the conversion itself never ran.
    expect(store.projects).toHaveLength(1);
  });

  it("A25a: a REJECTED (thrown) conversion_blocked audit rolls back the refusal write itself (MINIMUM_DATA_MISSING branch)", async () => {
    seedLead({ projectType: null, serviceType: null });
    (logAudit as any).mockRejectedValueOnce(new Error("audit connection lost"));

    // The audit failure surfaces as its own error — not silently merged into the
    // expected MINIMUM_DATA_MISSING business refusal.
    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toThrow("audit connection lost");

    expect(store.leads[0].conversionDecision).toBeUndefined();
    expect(store.leads[0].status).toBe("qualified");
    expect(store.audit_events).toHaveLength(0);
  });

  it("A25b: a NULL-returning conversion_blocked audit rolls back the refusal write (MINIMUM_DATA_MISSING branch)", async () => {
    seedLead({ projectType: null, serviceType: null });
    (logAudit as any).mockResolvedValueOnce(null);

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toThrow(/audit insert failed/i);

    expect(store.leads[0].conversionDecision).toBeUndefined();
    expect(store.leads[0].status).toBe("qualified");
    expect(store.audit_events).toHaveLength(0);
  });

  it("A25c: a rejected conversion_blocked audit also rolls back the refusal write on the NEEDS_REVIEW branch", async () => {
    seedLead();
    store.projects.push({
      id: "project-existing-dup",
      tenantId: TENANT,
      address: "412 Palmetto Street",
      projectType: "remodel",
      status: "in_progress",
      deletedAt: null,
      clientId: null,
    });
    (logAudit as any).mockRejectedValueOnce(new Error("audit connection lost"));

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toThrow("audit connection lost");

    expect(store.leads[0].conversionDecision).toBeUndefined();
    expect(store.audit_events).toHaveLength(0);
  });
});

describe("PHASE 2 flow — Group A2: actor identity (V3: identity/replay)", () => {
  it("A26: an actor with no matching profile is refused before any write", async () => {
    seedLead();
    store.profiles = []; // no profile for USER at all

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "ACTOR_INVALID" });
    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
  });

  it("A27: an inactive actor is refused before any write", async () => {
    seedLead();
    store.profiles = [{ id: USER, tenantId: TENANT, isActive: false, role: "member" }];

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "ACTOR_INVALID" });
    expect(store.projects).toHaveLength(0);
  });

  it("A28: an actor whose OWN tenant differs from the call's tenant is refused", async () => {
    seedLead();
    store.profiles = [{ id: USER, tenantId: "other-tenant", isActive: true, role: "member" }];

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "ACTOR_INVALID" });
    expect(store.projects).toHaveLength(0);
  });

  it("A29: LEADS_OWNER_SCOPE on — a non-admin actor who does NOT own the lead is refused", async () => {
    const previous = process.env.LEADS_OWNER_SCOPE;
    process.env.LEADS_OWNER_SCOPE = "true";
    try {
      seedLead({ ownerUserId: "someone-else" });
      seedActor({ id: "someone-else", tenantId: TENANT, isActive: true, role: "member" });
      await expect(
        convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
      ).rejects.toThrow();
      expect(store.projects).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.LEADS_OWNER_SCOPE;
      else process.env.LEADS_OWNER_SCOPE = previous;
    }
  });

  it("A30: LEADS_OWNER_SCOPE on — the actor who DOES own the lead succeeds", async () => {
    const previous = process.env.LEADS_OWNER_SCOPE;
    process.env.LEADS_OWNER_SCOPE = "true";
    try {
      seedLead({ ownerUserId: USER });
      const result = await convertLeadToProject({
        leadId: "lead-1",
        tenantId: TENANT,
        userId: USER,
        resolveGeo: false,
      });
      expect(result.created).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.LEADS_OWNER_SCOPE;
      else process.env.LEADS_OWNER_SCOPE = previous;
    }
  });

  it("A31: LEADS_OWNER_SCOPE on — an admin actor succeeds regardless of lead ownership", async () => {
    const previous = process.env.LEADS_OWNER_SCOPE;
    process.env.LEADS_OWNER_SCOPE = "true";
    try {
      seedLead({ ownerUserId: "someone-else" });
      store.profiles = [
        { id: USER, tenantId: TENANT, isActive: true, role: "admin" },
        { id: "someone-else", tenantId: TENANT, isActive: true, role: "member" },
      ];
      const result = await convertLeadToProject({
        leadId: "lead-1",
        tenantId: TENANT,
        userId: USER,
        resolveGeo: false,
      });
      expect(result.created).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.LEADS_OWNER_SCOPE;
      else process.env.LEADS_OWNER_SCOPE = previous;
    }
  });
});

describe("PHASE 2 flow — Group A3: owner resolution", () => {
  it("A32: a valid persisted lead owner (different from the actor) is preserved on the project", async () => {
    seedActor({ id: "owner-1", tenantId: TENANT, isActive: true, role: "member" });
    seedLead({ ownerUserId: "owner-1" });

    await convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false });

    expect(store.projects[0].ownerUserId).toBe("owner-1");
  });

  it("A33: a null lead owner falls back to the validated actor", async () => {
    seedLead({ ownerUserId: null });
    await convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false });
    expect(store.projects[0].ownerUserId).toBe(USER);
  });

  it("A34: a NON-null but invalid lead owner is refused, never silently replaced by the actor", async () => {
    seedLead({ ownerUserId: "ghost-owner" }); // no matching profile seeded
    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "OWNER_INVALID" });
    expect(store.projects).toHaveLength(0);
  });

  it("A35: a lead owner from a DIFFERENT tenant is refused, not silently replaced", async () => {
    seedActor({ id: "owner-1", tenantId: "other-tenant", isActive: true, role: "member" });
    seedLead({ ownerUserId: "owner-1" });
    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "OWNER_INVALID" });
    expect(store.projects).toHaveLength(0);
  });
});

describe("PHASE 2 flow — Group A4: verified replay, no cross-route duplication", () => {
  it("A36: an existing project correlated only by leadId (no marker set — e.g. converted by the OTHER route) is found and returned, not duplicated", async () => {
    store.clients.push({ id: "client-legacy", tenantId: TENANT, isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-legacy",
      tenantId: TENANT,
      leadId: "lead-1",
      clientId: "client-legacy",
      deletedAt: null,
      ownerUserId: USER,
    });
    seedLead(); // convertedProjectId/convertedClientId NOT set — legacy route never sets them

    const result = await convertLeadToProject({
      leadId: "lead-1",
      tenantId: TENANT,
      userId: USER,
      resolveGeo: false,
    });

    expect(result.created).toBe(false);
    expect(result.projectId).toBe("project-legacy");
    expect(result.clientId).toBe("client-legacy");
    expect(store.projects).toHaveLength(1);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("A37: a converted marker with NO matching project (broken link) is refused, not treated as 'none'", async () => {
    seedLead({ convertedProjectId: "ghost-project", status: "converted" });
    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "CONVERSION_LINK_INCONSISTENT" });
    expect(store.projects).toHaveLength(0);
  });

  it("A38: two projects referencing the same lead (ambiguous) are refused rather than guessed at", async () => {
    store.projects.push(
      { id: "project-a", tenantId: TENANT, leadId: "lead-1", clientId: "client-a", deletedAt: null },
      { id: "project-b", tenantId: TENANT, leadId: "lead-1", clientId: "client-b", deletedAt: null },
    );
    seedLead();
    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "CONVERSION_LINK_AMBIGUOUS" });
  });

  it("A38b: rows exist for this lead but are all foreign/deleted, with NO marker at all — a broken link, not 'none'", async () => {
    store.projects.push({
      id: "project-deleted",
      tenantId: TENANT,
      leadId: "lead-1",
      clientId: "client-z",
      deletedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    seedLead(); // no markers set at all
    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "CONVERSION_LINK_INCONSISTENT" });
    expect(store.clients).toHaveLength(0);
  });
});

describe("PHASE 2 flow — Group A5: interference exactly at lock acquisition (V3: single coordinated transaction)", () => {
  // V3 restructured convertLeadToProject into ONE transaction: the lead lock, actor/scope
  // validation, replay check, and plan-building all happen on the SAME locked row — there
  // is no separate unlocked pre-read whose plan/owner could go stale before a later
  // re-lock (that was V2's gap). These tests inject a mutation at the exact instant the
  // lead's lock is acquired (the tightest possible race window this single-transaction
  // design still has) and confirm the ONE read that follows sees the CURRENT state, not a
  // cached one — either by using the fresh value correctly, or refusing under the fresh
  // value's own rules, never under a stale one.
  it("A39: the actor is deactivated exactly as the lead lock is acquired — the one coordinated read sees it and refuses", async () => {
    seedLead();
    onLockAcquireQueue.push(() => {
      const actor = store.profiles.find((p) => p.id === USER);
      if (actor) actor.isActive = false;
    });

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "ACTOR_INVALID" });
    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("A40: the lead's owner is reassigned exactly as the lock is acquired — the one coordinated read uses the NEW owner, not a stale one (no separate conflict check needed)", async () => {
    seedActor({ id: "new-owner", tenantId: TENANT, isActive: true, role: "member" });
    seedLead({ ownerUserId: USER });
    onLockAcquireQueue.push(() => {
      const l = store.leads.find((x) => x.id === "lead-1");
      if (l) l.ownerUserId = "new-owner";
    });

    const result = await convertLeadToProject({
      leadId: "lead-1",
      tenantId: TENANT,
      userId: USER,
      resolveGeo: false,
    });
    expect(result.created).toBe(true);
    expect(store.projects[0].ownerUserId).toBe("new-owner");
  });

  it("A41: the lead's tenant changes exactly as the lock is acquired — refused as TENANT_MISMATCH under the fresh value, not the stale one", async () => {
    seedLead();
    onLockAcquireQueue.push(() => {
      const l = store.leads.find((x) => x.id === "lead-1");
      if (l) l.tenantId = "other-tenant";
    });

    // assertSameTenant runs immediately after the single lock, on the row the lock just
    // returned — the mutation lands before that check ever runs, so it sees the NEW
    // (mismatched) tenant directly. There is no separate "was it stale" question to ask.
    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "TENANT_MISMATCH" });
    expect(store.projects).toHaveLength(0);
  });

  it("A42: a client this conversion plans to reuse is deactivated exactly as ITS OWN lock is acquired (the second FOR UPDATE in the transaction, after the lead's) — refused, not silently created fresh", async () => {
    store.clients.push({
      id: "client-own",
      tenantId: TENANT,
      name: "Sarah Whitfield",
      email: "sarah.whitfield@example.com",
      phone: "8435550142",
      address: "412 Palmetto Street",
      city: "Charleston",
      state: "SC",
      zip: "29403",
      deletedAt: null,
      isActive: true,
    });
    seedLead();
    // The lead's own lock is the FIRST FOR UPDATE in the transaction; the reused client's
    // is the second. Queue a no-op for the first so the mutation lands on the client's.
    onLockAcquireQueue.push(() => {});
    onLockAcquireQueue.push(() => {
      const c = store.clients.find((x) => x.id === "client-own");
      if (c) c.isActive = false;
    });

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(store.projects).toHaveLength(0);
  });

  it("A43: the actor is deactivated exactly as the lead lock is acquired, on a lead that would otherwise be BLOCKED — refused before the decision is ever written", async () => {
    seedLead({ projectType: null, serviceType: null }); // triggers MINIMUM_DATA_MISSING
    onLockAcquireQueue.push(() => {
      const actor = store.profiles.find((p) => p.id === USER);
      if (actor) actor.isActive = false;
    });

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "ACTOR_INVALID" });
    expect(store.leads[0].conversionDecision).toBeUndefined();
    expect(logAudit).not.toHaveBeenCalled();
  });
});

describe("PHASE 2 flow — Group A6: project ACL and foreign client/deal verification", () => {
  it("A44: a project correctly linked to the lead, but with no ACL grant for this actor, is refused as forbidden", async () => {
    seedActor({ id: "owner-elsewhere", tenantId: TENANT, isActive: true, role: "member" });
    store.clients.push({ id: "client-shared", tenantId: TENANT, isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-shared",
      tenantId: TENANT,
      leadId: "lead-1",
      clientId: "client-shared",
      deletedAt: null,
      ownerUserId: "owner-elsewhere",
    });
    seedLead({ convertedProjectId: "project-shared", convertedClientId: "client-shared", status: "converted" });

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "PROJECT_ACCESS_DENIED" });
  });

  it("A45: a client that exists but belongs to another tenant is unresolvable — inconsistent, not found", async () => {
    store.clients.push({ id: "client-foreign", tenantId: "other-tenant", isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-x",
      tenantId: TENANT,
      leadId: "lead-1",
      clientId: "client-foreign",
      deletedAt: null,
      ownerUserId: USER,
    });
    seedLead({ convertedProjectId: "project-x", convertedClientId: "client-foreign", status: "converted" });

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "CONVERSION_LINK_INCONSISTENT" });
  });

  it("A45b: the project's OWN leadId changes exactly as requireProjectAccess locks it (after the initial unlocked read, before the guard's own FOR UPDATE) — the post-lock re-read catches it, not the earlier snapshot", async () => {
    store.clients.push({ id: "client-p", tenantId: TENANT, isActive: true, deletedAt: null });
    store.projects.push({
      id: "project-p",
      tenantId: TENANT,
      leadId: "lead-1",
      clientId: "client-p",
      deletedAt: null,
      ownerUserId: USER,
    });
    seedLead({ convertedProjectId: "project-p", convertedClientId: "client-p", status: "converted" });
    // FOR UPDATE #1 is the lead's own lock (no-op here); #2 is requireProjectAccess's own
    // lock on the project row — mutate its leadId there, AFTER the first unlocked read of
    // it already happened inside findExistingConversionForLead.
    onLockAcquireQueue.push(() => {});
    onLockAcquireQueue.push(() => {
      const p = store.projects.find((x) => x.id === "project-p");
      if (p) p.leadId = "someone-elses-lead";
    });

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "CONVERSION_LINK_INCONSISTENT" });
    expect(store.clients).toHaveLength(1); // no new client created
    expect(store.projects).toHaveLength(1); // no new project created
  });

  it("A45c: an orphan deal (leadId set, no project, no markers) is inconsistent, not 'none'", async () => {
    store.deals.push({ id: "deal-orphan", leadId: "lead-1", tenantId: TENANT });
    seedLead(); // no markers, no project — only an orphan deal

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "CONVERSION_LINK_INCONSISTENT" });
    expect(store.clients).toHaveLength(0);
    expect(store.projects).toHaveLength(0);
  });

  it("A45d: two projects for the same lead — one valid, one foreign-tenant — are ambiguous, never silently narrowed to the valid one", async () => {
    store.clients.push({ id: "client-valid", tenantId: TENANT, isActive: true, deletedAt: null });
    store.projects.push(
      { id: "project-valid", tenantId: TENANT, leadId: "lead-1", clientId: "client-valid", deletedAt: null, ownerUserId: USER },
      { id: "project-foreign", tenantId: "other-tenant", leadId: "lead-1", clientId: "client-other", deletedAt: null },
    );
    seedLead({ convertedProjectId: "project-valid", convertedClientId: "client-valid", status: "converted" });

    await expect(
      convertLeadToProject({ leadId: "lead-1", tenantId: TENANT, userId: USER, resolveGeo: false }),
    ).rejects.toMatchObject({ code: "CONVERSION_LINK_AMBIGUOUS" });
  });

  it("A46: planLeadConversion (read-only) is not exempt from lead-access authorization — LEADS_OWNER_SCOPE on, non-owner refused", async () => {
    const previous = process.env.LEADS_OWNER_SCOPE;
    process.env.LEADS_OWNER_SCOPE = "true";
    try {
      seedLead({ ownerUserId: "someone-else" });
      seedActor({ id: "someone-else", tenantId: TENANT, isActive: true, role: "member" });
      await expect(
        planLeadConversion({ leadId: "lead-1", tenantId: TENANT, userId: USER }),
      ).rejects.toThrow();
    } finally {
      if (previous === undefined) delete process.env.LEADS_OWNER_SCOPE;
      else process.env.LEADS_OWNER_SCOPE = previous;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP B — ESTIMATE APPROVAL GATE (PROFIT SHIELD)
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 2 flow — Group B: estimate approval gate", () => {
  // C2-A: these old id-only commands no longer approve. Keep the independent
  // channel/geo arithmetic assertions, then prove the former positive path is held.
  it.each([
    ["B1 premium compliant", "premium", "inland", "600.00", 28, false],
    ["B2 premium below floor", "premium", "inland", "780.00", 28, true],
    ["B3 trade compliant", "trade", "inland", "780.00", 18, false],
    ["B4 capital compliant", "capital", "inland", "850.00", 15, false],
    ["B5 coastal floor", "trade", "coastal", "700.00", 42, true],
    ["B6 barrier island floor", "premium", "barrier_island", "550.00", 50, true],
  ] as const)("%s remains a neutral policy fact, not legacy approval", async (_name, channel, geoRiskClass, cost, floor, blocked) => {
    const draft = seedEstimate({ subtotalCost: cost, finalTotalPrice: "1000.00", commercialChannel: channel,
      pricingSnapshot: { commercialChannel: channel, zone: "Synthetic", geoRiskClass } });
    const evaluation = evaluateDraftProfitShield(draft as never);
    expect(evaluation.effectiveFloorPct).toBe(floor); expect(evaluation.blocked).toBe(blocked);
    const before = structuredClone(store.estimate_drafts);
    await expect(approveEstimateDraft("est-1", APPROVER)).rejects.toMatchObject({ code: "LEGACY_ESTIMATE_OPERATION_UNAVAILABLE" });
    expect(store.estimate_drafts).toEqual(before);
  });

  it("B7: the shield evaluation reads the draft's own snapshot", () => {
    const draft = seedEstimate({ subtotalCost: "600.00", finalTotalPrice: "1000.00" });
    const evaluation = evaluateDraftProfitShield(draft as never);

    expect(evaluation.channel).toBe("premium");
    expect(evaluation.actualPct).toBeCloseTo(40, 5);
    expect(evaluation.blocked).toBe(false);
  });

  it("B8: an approved estimate is immutable — discount is refused", async () => {
    seedMutableEstimate({ status: "approved", approvedAt: new Date(), approvedBy: APPROVER });

    await expect(applyEstimateDraftDiscount(MUTATION_DRAFT, 10, USER, TENANT)).rejects.toMatchObject({
      code: "ESTIMATE_VERSION_LOCKED",
    });
    expect(store.estimate_drafts[0].finalTotalPrice).toBe("1000.00");
  });

  it("B9: a discount on a draft estimate is allowed", async () => {
    seedMutableEstimate();
    await applyEstimateDraftDiscount(MUTATION_DRAFT, 10, USER, TENANT);
    expect(store.estimate_drafts[0].finalTotalPrice).toBe("900.00");
  });

  it("B10: the mutability guard names the operation it blocked", () => {
    expect(() =>
      assertEstimateMutable({ id: "est-1", status: "approved", version: 3 } as never, "editLineItems"),
    ).toThrow(/editLineItems/);
    expect(() =>
      assertEstimateMutable({ id: "est-1", status: "draft", version: 1 } as never, "editLineItems"),
    ).not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP C — VERSIONING AND CHANGE ORDERS
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 2 flow — Group C: versioning and change orders", () => {
  it("C1: old version command is held without copying or superseding the approved source", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date(), approvedBy: APPROVER });

    const before = structuredClone(store.estimate_drafts);
    await expect(createEstimateVersion({ sourceDraftId: "est-1", userId: USER,
      reason: "Client removed the butler pantry from the scope." })).rejects.toMatchObject({ code: "LEGACY_ESTIMATE_OPERATION_UNAVAILABLE" });
    expect(store.estimate_drafts).toEqual(before);
  });

  it("C2: a version requires a substantive reason", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date() });

    await expect(
      createEstimateVersion({ sourceDraftId: "est-1", userId: USER, reason: "fix" }),
    ).rejects.toBeInstanceOf(LegacyEstimateOperationError);
  });

  it("C3: an already superseded draft cannot be versioned again", async () => {
    seedEstimate({ status: "approved", supersededBy: "est-9" });

    await expect(
      createEstimateVersion({
        sourceDraftId: "est-1",
        userId: USER,
        reason: "Attempting to branch from a stale version.",
      }),
    ).rejects.toMatchObject({ code: "LEGACY_ESTIMATE_OPERATION_UNAVAILABLE" });
  });

  it("C4: a change order requires an approved base", async () => {
    seedEstimate({ status: "draft" });

    await expect(
      createChangeOrder({
        baseDraftId: "est-1",
        userId: USER,
        reason: "Owner added exterior painting to the contracted scope.",
      }),
    ).rejects.toMatchObject({ code: "LEGACY_ESTIMATE_OPERATION_UNAVAILABLE" });
  });

  it("C5: old change order command cannot inherit authority from legacy approved", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date(), approvedBy: APPROVER });

    const before = structuredClone(store.estimate_drafts);
    await expect(createChangeOrder({
      baseDraftId: "est-1",
      userId: USER,
      reason: "Owner added exterior painting to the contracted scope.",
      subtotalCost: 1200,
      subtotalPrice: 2000,
    })).rejects.toMatchObject({ code: "LEGACY_ESTIMATE_OPERATION_UNAVAILABLE" });
    expect(store.estimate_drafts).toEqual(before);
  });

  it("C6: version chain retains facts without identifying active approval authority", async () => {
    seedEstimate({ id: "est-1", version: 1, status: "approved", supersededBy: "est-2", approvedAt: new Date() });
    seedEstimate({ id: "est-2", version: 2, status: "approved", supersedesId: "est-1", approvedAt: new Date() });

    const chain = await getVersionChain("project-1");
    expect(chain.versions).toHaveLength(2);
    expect(chain.activeApprovedId).toBeNull();
  });

  it("C7: a change order is not offered as the exportable project budget", async () => {
    seedEstimate({ id: "est-1", status: "approved", approvedAt: new Date() });
    seedEstimate({ id: "est-2", version: 2, status: "approved", changeOrderOf: "est-1", approvedAt: new Date() });

    const exportable = await getExportableEstimate("project-1");
    expect(exportable).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP D — JOBTREAD EXPORT GATE
// ══════════════════════════════════════════════════════════════════════

// C2-A revokes the old generate/persist/download protocol; no partial governed
// attempt is admitted. Neutral reconciliation/manifest/format controls remain.
describe("PHASE 2 flow — Group D: JobTread compatibility hold", () => {
  it.each([
    ["D1 draft", { status: "draft" }],
    ["D3 superseded", { status: "approved", approvedAt: new Date(), supersededBy: "est-2" }],
    ["D4 missing stamp", { status: "approved", approvedAt: null }],
  ])("%s has no positive export authority", async (_name, patch) => {
    seedEstimate(patch as Row); expect(await checkExportAuthorization("est-1")).toEqual({ authorized: false, reason: expect.stringMatching(/unavailable/i) });
  });
  it.each([
    ["D2 draft", { status: "draft" }],
    ["D5 reconciled approved", { status: "approved", approvedAt: new Date(), approvedBy: APPROVER }],
    ["D6 mismatched total", { status: "approved", approvedAt: new Date(), finalTotalPrice: "1500.00" }],
    ["D7 discount exception", { status: "approved", approvedAt: new Date(), finalTotalPrice: "900.00" }],
  ])("%s cannot admit a legacy attempt", async (_name, patch) => {
    seedEstimate(patch as Row); const before = structuredClone(store);
    await expect(requestJobTreadExport({ estimateDraftId: "est-1", userId: USER, tenantId: TENANT,
      declaredAdjustments: [{ kind: "discount", amount: "100.00", reason: "synthetic" }] })).rejects.toBeInstanceOf(LegacyEstimateOperationError);
    expect(store).toEqual(before);
  });
  const row: JobTreadCsvRow = { "Cost Group Name": "Finish", "Cost Item Name": "Synthetic item", Description: "Synthetic", Quantity: "2", Unit: "Each", "Unit Cost": "200.00", "Unit Price": "500.00", "Cost Type": "Material", Taxable: "False" };
  it("D8 pure manifest retains explicit cost codes without admitting export", () => {
    const reconciliation = reconcileExport({ rows: [row], approvedTotal: "1000.00" });
    const manifest = buildExportManifest({ estimateDraftId: "est-1", estimateVersion: 1, projectId: "project-1", tenantId: TENANT,
      rows: [row], rowMetadata: [{ costCode: "09-000", costCodeSource: "line_item" }], reconciliation });
    expect(manifest.rows[0].costCode).toBe("09-000"); expect(manifest.rows[0].costCodeSource).toBe("line_item"); expect(manifest.contractVersion).toBe("csv-v1.0");
    expect(store.jobtread_exports).toEqual([]);
  });
  it("D9 explicit-row CSV keeps nine columns and false taxability", () => {
    const csv = generateCsvString([row]); expect(csv.replace(/^\uFEFF/, "").split(/\r?\n/)[0].split(",")).toHaveLength(9);
    expect(csv).toContain("False"); expect(store.jobtread_exports).toEqual([]);
  });
  it.each(["approved_for_download", "blocked_reconciliation", "downloaded"])("D10-D12 %s and even an unchanged hash do not authorize download", async status => {
    store.jobtread_exports.push({ id: "export-1", status, csvHash: "synthetic", estimateDraftId: "est-1" });
    const before = structuredClone(store);
    await expect(downloadJobTreadExport("export-1", USER)).rejects.toBeInstanceOf(LegacyEstimateOperationError);
    expect(store).toEqual(before);
  });
  it("D13 repeats refusal without persisting partial governed attempts", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date() });
    for (let n = 0; n < 2; n++) await expect(requestJobTreadExport({ estimateDraftId: "est-1", userId: USER, tenantId: TENANT })).rejects.toBeInstanceOf(LegacyEstimateOperationError);
    expect(store.jobtread_exports).toEqual([]);
  });
  it("D14 direct download refuses without disclosing record existence", async () => {
    await expect(downloadJobTreadExport("11111111-1111-4111-8111-99999999", USER)).rejects.toBeInstanceOf(LegacyEstimateOperationError);
  });
  it("D15 neutral reconciliation retains integer cents without export record", () => {
    expect(reconcileExport({ rows: [row], approvedTotal: "1000.00" })).toMatchObject({ approvedTotalCents: 100000, exportedTotalCents: 100000, differenceCents: 0 });
    expect(store.jobtread_exports).toEqual([]);
  });
});
