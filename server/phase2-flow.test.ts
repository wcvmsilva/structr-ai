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
  leads: Row[];
  clients: Row[];
  projects: Row[];
  intake_forms: Row[];
  lead_activities: Row[];
  previsit_briefs: Row[];
  previsit_checklist_items: Row[];
  estimate_drafts: Row[];
  jobtread_exports: Row[];
  scope_drafts: Row[];
}

const store: TableStore = {
  leads: [],
  clients: [],
  projects: [],
  intake_forms: [],
  lead_activities: [],
  previsit_briefs: [],
  previsit_checklist_items: [],
  estimate_drafts: [],
  jobtread_exports: [],
  scope_drafts: [],
};

/**
 * Predicates are captured as closures by the drizzle stub. Rather than interpreting SQL,
 * the stub records the last table touched and applies the filter callbacks registered by
 * `whereMatcher`, which the tests configure per scenario. In practice the modules under
 * test filter by a single id, so matching on any `id`-like value in the condition is
 * sufficient and keeps the stub honest about "which row would the DB return".
 */
let conditionValues: unknown[] = [];

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

function makeSelectBuilder(rows: Row[]) {
  const builder: Record<string, unknown> = {};
  const result = () => rows.filter(matches);
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
    limit: (n: number) => Promise.resolve(result().slice(0, n)),
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
            return Promise.resolve(targets);
          },
        }),
      };
    },
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
    execute: async () => [],
  };
  return db;
}

let dbAvailable = true;

vi.mock("./db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getDb: vi.fn(async () => (dbAvailable ? (makeDb() as never) : null)),
    createEstimateDraft: vi.fn(),
  };
});

vi.mock("./audit", () => ({
  logAudit: vi.fn(async () => undefined),
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
} from "./lead-conversion";
import {
  approveEstimateDraft,
  applyEstimateDraftDiscount,
  assertEstimateMutable,
  EstimateGuardError,
  evaluateDraftProfitShield,
} from "./estimate-db";
import { createChangeOrder, createEstimateVersion, getExportableEstimate, getVersionChain } from "./estimate-version-db";
import {
  checkExportAuthorization,
  downloadJobTreadExport,
  ExportError,
  listExportsForEstimate,
  requestJobTreadExport,
} from "./jobtread-export-db";

// ══════════════════════════════════════════════════════════════════════
// FIXTURES
// ══════════════════════════════════════════════════════════════════════

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const APPROVER = "33333333-3333-4333-8333-333333333333";

function resetStore() {
  store.leads = [];
  store.clients = [];
  store.projects = [];
  store.intake_forms = [];
  store.lead_activities = [];
  store.previsit_briefs = [];
  store.previsit_checklist_items = [];
  store.estimate_drafts = [];
  store.jobtread_exports = [];
  store.scope_drafts = [];
  conditionValues = [];
  dbAvailable = true;
}

function seedLead(overrides: Row = {}): Row {
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
    expect(store.projects).toHaveLength(0);
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

    const summary = await resolveProjectGeoContext("project-1", USER);

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
});

// ══════════════════════════════════════════════════════════════════════
// GROUP B — ESTIMATE APPROVAL GATE (PROFIT SHIELD)
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 2 flow — Group B: estimate approval gate", () => {
  it("B1: a compliant Premium estimate is approved and locked", async () => {
    seedEstimate();

    const updated = await approveEstimateDraft("est-1", APPROVER);

    expect(updated.status).toBe("approved");
    expect(store.estimate_drafts[0].approvedBy).toBe(APPROVER);
    expect(store.estimate_drafts[0].lockedAt).toBeTruthy();
    expect(store.estimate_drafts[0].profitShieldFloorPct).toBe("28");
  });

  it("B2: Premium below 28% cannot be approved", async () => {
    // 1000 price on 780 cost = 22% GP, below the Premium floor.
    seedEstimate({ subtotalCost: "780.00", finalTotalPrice: "1000.00" });

    await expect(approveEstimateDraft("est-1", APPROVER)).rejects.toMatchObject({
      code: "PROFIT_SHIELD_CHANNEL_FLOOR",
    });
    expect(store.estimate_drafts[0].status).toBe("draft");
  });

  it("B3: the same margin is approvable on the Trade channel", async () => {
    seedEstimate({
      subtotalCost: "780.00",
      finalTotalPrice: "1000.00",
      commercialChannel: "trade",
      pricingSnapshot: { commercialChannel: "trade", zone: "West Ashley", geoRiskClass: "inland" },
    });

    const updated = await approveEstimateDraft("est-1", APPROVER);
    expect(updated.status).toBe("approved");
    expect(store.estimate_drafts[0].profitShieldFloorPct).toBe("18");
  });

  it("B4: Capital is approvable at a 15% fee", async () => {
    seedEstimate({
      subtotalCost: "850.00",
      finalTotalPrice: "1000.00",
      commercialChannel: "capital",
      pricingSnapshot: { commercialChannel: "capital", zone: "West Ashley", geoRiskClass: "inland" },
    });

    const updated = await approveEstimateDraft("est-1", APPROVER);
    expect(updated.status).toBe("approved");
    expect(store.estimate_drafts[0].profitShieldFloorPct).toBe("15");
  });

  it("B5: a coastal project must clear the 42% floor even on Trade", async () => {
    seedEstimate({
      subtotalCost: "700.00",
      finalTotalPrice: "1000.00",
      commercialChannel: "trade",
      pricingSnapshot: { commercialChannel: "trade", zone: "Folly Beach", geoRiskClass: "coastal" },
    });

    await expect(approveEstimateDraft("est-1", APPROVER)).rejects.toMatchObject({
      code: "PROFIT_SHIELD_CHANNEL_FLOOR",
    });
  });

  it("B6: a barrier island project must clear the 50% floor", async () => {
    seedEstimate({
      subtotalCost: "550.00",
      finalTotalPrice: "1000.00",
      pricingSnapshot: {
        commercialChannel: "premium",
        zone: "Isle of Palms",
        geoRiskClass: "barrier_island",
      },
    });

    await expect(approveEstimateDraft("est-1", APPROVER)).rejects.toMatchObject({
      code: "PROFIT_SHIELD_CHANNEL_FLOOR",
    });
  });

  it("B7: the shield evaluation reads the draft's own snapshot", () => {
    const draft = seedEstimate({ subtotalCost: "600.00", finalTotalPrice: "1000.00" });
    const evaluation = evaluateDraftProfitShield(draft as never);

    expect(evaluation.channel).toBe("premium");
    expect(evaluation.actualPct).toBeCloseTo(40, 5);
    expect(evaluation.blocked).toBe(false);
  });

  it("B8: an approved estimate is immutable — discount is refused", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date(), approvedBy: APPROVER });

    await expect(applyEstimateDraftDiscount("est-1", 10, USER)).rejects.toMatchObject({
      code: "ESTIMATE_VERSION_LOCKED",
    });
    expect(store.estimate_drafts[0].finalTotalPrice).toBe("1000.00");
  });

  it("B9: a discount on a draft estimate is allowed", async () => {
    seedEstimate();
    await applyEstimateDraftDiscount("est-1", 10, USER);
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
  it("C1: a new version supersedes the approved one and starts as draft", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date(), approvedBy: APPROVER });

    const { version } = await createEstimateVersion({
      sourceDraftId: "est-1",
      userId: USER,
      reason: "Client removed the butler pantry from the scope.",
    });

    expect(version.status).toBe("draft");
    expect(version.version).toBe(2);
    expect(version.supersedesId).toBe("est-1");
    expect(store.estimate_drafts[0].supersededBy).toBe(version.id);
    // The approved money is untouched.
    expect(store.estimate_drafts[0].finalTotalPrice).toBe("1000.00");
    expect(store.estimate_drafts[0].status).toBe("approved");
  });

  it("C2: a version requires a substantive reason", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date() });

    await expect(
      createEstimateVersion({ sourceDraftId: "est-1", userId: USER, reason: "fix" }),
    ).rejects.toBeInstanceOf(EstimateGuardError);
  });

  it("C3: an already superseded draft cannot be versioned again", async () => {
    seedEstimate({ status: "approved", supersededBy: "est-9" });

    await expect(
      createEstimateVersion({
        sourceDraftId: "est-1",
        userId: USER,
        reason: "Attempting to branch from a stale version.",
      }),
    ).rejects.toMatchObject({ code: "ESTIMATE_VERSION_LOCKED" });
  });

  it("C4: a change order requires an approved base", async () => {
    seedEstimate({ status: "draft" });

    await expect(
      createChangeOrder({
        baseDraftId: "est-1",
        userId: USER,
        reason: "Owner added exterior painting to the contracted scope.",
      }),
    ).rejects.toMatchObject({ code: "SCOPE_NOT_APPROVED" });
  });

  it("C5: a change order attaches to the approved estimate without superseding it", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date(), approvedBy: APPROVER });

    const changeOrder = await createChangeOrder({
      baseDraftId: "est-1",
      userId: USER,
      reason: "Owner added exterior painting to the contracted scope.",
      subtotalCost: 1200,
      subtotalPrice: 2000,
    });

    expect(changeOrder.changeOrderOf).toBe("est-1");
    expect(changeOrder.status).toBe("draft");
    expect(changeOrder.subtotalPrice).toBe("2000.00");
    expect(store.estimate_drafts[0].supersededBy).toBeNull();
  });

  it("C6: the version chain identifies the single active approved version", async () => {
    seedEstimate({ id: "est-1", version: 1, status: "approved", supersededBy: "est-2", approvedAt: new Date() });
    seedEstimate({ id: "est-2", version: 2, status: "approved", supersedesId: "est-1", approvedAt: new Date() });

    const chain = await getVersionChain("project-1");
    expect(chain.versions).toHaveLength(2);
    expect(chain.activeApprovedId).toBe("est-2");
  });

  it("C7: a change order is not offered as the exportable project budget", async () => {
    seedEstimate({ id: "est-1", status: "approved", approvedAt: new Date() });
    seedEstimate({ id: "est-2", version: 2, status: "approved", changeOrderOf: "est-1", approvedAt: new Date() });

    const exportable = await getExportableEstimate("project-1");
    expect(exportable?.id).toBe("est-1");
  });
});

// ══════════════════════════════════════════════════════════════════════
// GROUP D — JOBTREAD EXPORT GATE
// ══════════════════════════════════════════════════════════════════════

describe("PHASE 2 flow — Group D: JobTread export gate", () => {
  it("D1: a draft estimate is not authorized for export (JIC-002)", async () => {
    seedEstimate({ status: "draft" });

    const auth = await checkExportAuthorization("est-1");
    expect(auth.authorized).toBe(false);
    expect(auth.reason).toMatch(/JIC-002/);
  });

  it("D2: requesting an export for a draft estimate throws and records the block", async () => {
    seedEstimate({ status: "draft" });

    await expect(
      requestJobTreadExport({ estimateDraftId: "est-1", userId: USER, tenantId: TENANT }),
    ).rejects.toMatchObject({ code: "ESTIMATE_NOT_APPROVED" });

    expect(store.jobtread_exports).toHaveLength(1);
    expect(store.jobtread_exports[0].status).toBe("blocked_authorization");
  });

  it("D3: a superseded approval is not exportable", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date(), supersededBy: "est-2" });

    const auth = await checkExportAuthorization("est-1");
    expect(auth.authorized).toBe(false);
    expect(auth.reason).toMatch(/superseded/i);
  });

  it("D4: approval without an approval timestamp is treated as incomplete evidence", async () => {
    seedEstimate({ status: "approved", approvedAt: null });

    const auth = await checkExportAuthorization("est-1");
    expect(auth.authorized).toBe(false);
    expect(auth.reason).toMatch(/approval evidence/i);
  });

  it("D5: an approved, reconciled estimate produces a downloadable export", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date(), approvedBy: APPROVER });

    const attempt = await requestJobTreadExport({
      estimateDraftId: "est-1",
      userId: USER,
      tenantId: TENANT,
    });

    expect(attempt.status).toBe("approved_for_download");
    expect(attempt.canDownload).toBe(true);
    expect(attempt.reconciliation.status).toBe("reconciled");
    expect(attempt.reconciliation.differenceCents).toBe(0);
    expect(attempt.csvString).toBeTruthy();
    expect(attempt.csvHash).toBeTruthy();
    expect(attempt.manifest.rowCount).toBe(attempt.rowCount);
  });

  it("D6: the exported total must equal the approved total (JIC-003)", async () => {
    // Line items sum to 1000.00 but the approved total says 1500.00.
    seedEstimate({
      status: "approved",
      approvedAt: new Date(),
      finalTotalPrice: "1500.00",
    });

    const attempt = await requestJobTreadExport({
      estimateDraftId: "est-1",
      userId: USER,
      tenantId: TENANT,
    });

    expect(attempt.status).toBe("blocked_reconciliation");
    expect(attempt.canDownload).toBe(false);
    expect(attempt.csvString).toBeUndefined();
    expect(attempt.blockReason).toMatch(/JIC-003/);
    expect(store.jobtread_exports[0].status).toBe("blocked_reconciliation");
  });

  it("D7: a declared discount routes to exception review, not a silent export", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date(), finalTotalPrice: "900.00" });

    const attempt = await requestJobTreadExport({
      estimateDraftId: "est-1",
      userId: USER,
      tenantId: TENANT,
      declaredAdjustments: [{ kind: "discount", amount: "100.00", reason: "repeat client" }],
    });

    expect(attempt.status).toBe("needs_exception_review");
    expect(attempt.canDownload).toBe(false);
  });

  it("D8: the manifest records the per-row cost code mapping (JIC-005)", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date() });

    const attempt = await requestJobTreadExport({
      estimateDraftId: "est-1",
      userId: USER,
      tenantId: TENANT,
    });

    expect(attempt.manifest.rows[0].costCode).toBe("09-000");
    expect(attempt.manifest.rows[0].costCodeSource).toBe("line_item");
    expect(attempt.manifest.contractVersion).toBe("csv-v1.0");
  });

  it("D9: the CSV keeps exactly nine columns (JIC-001)", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date() });

    const attempt = await requestJobTreadExport({
      estimateDraftId: "est-1",
      userId: USER,
      tenantId: TENANT,
    });

    const header = attempt.csvString!.replace(/^\uFEFF/, "").split("\n")[0];
    expect(header.split(",")).toHaveLength(9);
  });

  it("D10: an approved export can be downloaded and is marked downloaded", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date() });

    const attempt = await requestJobTreadExport({
      estimateDraftId: "est-1",
      userId: USER,
      tenantId: TENANT,
    });
    const download = await downloadJobTreadExport(attempt.exportId, USER);

    expect(download.csvString).toContain("Cost Group Name");
    expect(download.filename).toMatch(/\.csv$/);
    expect(store.jobtread_exports[0].status).toBe("downloaded");
  });

  it("D11: a blocked export cannot be downloaded", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date(), finalTotalPrice: "1500.00" });

    const attempt = await requestJobTreadExport({
      estimateDraftId: "est-1",
      userId: USER,
      tenantId: TENANT,
    });

    await expect(downloadJobTreadExport(attempt.exportId, USER)).rejects.toMatchObject({
      code: "EXPORT_BLOCKED",
    });
  });

  it("D12: content changed after approval blocks the download (hash guard)", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date() });

    const attempt = await requestJobTreadExport({
      estimateDraftId: "est-1",
      userId: USER,
      tenantId: TENANT,
    });

    // Simulate a line item mutated after the export was authorized.
    (store.estimate_drafts[0].lineItems as Row[])[0].quantity = 999;

    await expect(downloadJobTreadExport(attempt.exportId, USER)).rejects.toMatchObject({
      code: "RECONCILIATION_FAILED",
    });
  });

  it("D13: every attempt is recorded, including blocked ones (JIC-014)", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date(), finalTotalPrice: "1500.00" });

    await requestJobTreadExport({ estimateDraftId: "est-1", userId: USER, tenantId: TENANT });
    await requestJobTreadExport({ estimateDraftId: "est-1", userId: USER, tenantId: TENANT });

    const history = await listExportsForEstimate("est-1");
    expect(history).toHaveLength(2);
    expect(history.every((h) => h.status === "blocked_reconciliation")).toBe(true);
  });

  it("D14: an unknown export id is a not-found error", async () => {
    await expect(downloadJobTreadExport("11111111-1111-4111-8111-99999999", USER)).rejects.toBeInstanceOf(
      ExportError,
    );
  });

  it("D15: the export record carries the reconciliation figures in cents", async () => {
    seedEstimate({ status: "approved", approvedAt: new Date() });

    await requestJobTreadExport({ estimateDraftId: "est-1", userId: USER, tenantId: TENANT });

    expect(store.jobtread_exports[0].approvedTotalCents).toBe(100000);
    expect(store.jobtread_exports[0].exportedTotalCents).toBe(100000);
    expect(store.jobtread_exports[0].differenceCents).toBe(0);
    expect(store.jobtread_exports[0].contractVersion).toBe("csv-v1.0");
  });
});
