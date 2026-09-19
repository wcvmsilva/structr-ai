/**
 * Characterization, not a policy correction. Real tRPC/tenant middleware,
 * requireEntityAccess/requireProjectAccess/assertSameTenant and override engine.
 * Permissive cases document current acceptance; unresolved policy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Assembly, GeographicOverride, Profile, Project, ScopeDraft, ScopeDraftItem } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const boundary = vi.hoisted(() => ({
  getDb: vi.fn(), permission: vi.fn(), draft: vi.fn(), effectiveItems: vi.fn(),
  assemblies: vi.fn(), rules: vi.fn(), audit: vi.fn(), writeLog: vi.fn(),
  insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn(),
}));
vi.mock("./db", () => ({ getDb: boundary.getDb }));
vi.mock("./rbac", () => ({ hasPermission: boundary.permission }));
vi.mock("./audit", () => ({ logAudit: boundary.audit }));
vi.mock("./scope-db", () => ({ getScopeDraftWithItems: boundary.draft }));
vi.mock("./scope-review-db", () => ({ getEffectiveItems: boundary.effectiveItems }));
vi.mock("./assembly-db", () => ({ listAssemblies: boundary.assemblies }));
vi.mock("./geo-override-db", async importOriginal => ({
  ...await importOriginal<typeof import("./geo-override-db")>(),
  listOverrideRules: boundary.rules, writeOverrideLogEntries: boundary.writeLog,
}));
import { geoOverrideRouter } from "./geo-override-router";

const TENANT_A = "a2800000-0000-4000-8000-000000000001";
const TENANT_B = "a2800000-0000-4000-8000-000000000002";
const ACTOR = "b2800000-0000-4000-8000-000000000001";
const PROJECT = "c2800000-0000-4000-8000-000000000001";
const DRAFT = "d2800000-0000-4000-8000-000000000001";
const ORIGINAL = "e2800000-0000-4000-8000-000000000001";
const REPLACEMENT = "e2800000-0000-4000-8000-000000000002";
const RULE = "f2800000-0000-4000-8000-000000000001";
const ZONE = "Charleston Coastal";
const NOW = new Date("2026-09-18T15:00:00.000Z");

const actor: Profile = {
  id: ACTOR, tenantId: TENANT_A, role: "user", isActive: true,
  externalOpenId: "synthetic-g2-reader", fullName: "Synthetic Reader", companyName: null,
  email: "reader@example.invalid", loginMethod: "lab", lastSignedIn: null,
  createdAt: NOW, updatedAt: NOW,
};
const project: Project = {
  id: PROJECT, tenantId: TENANT_A, ownerUserId: ACTOR, name: "Synthetic coastal project",
  clientId: null, clientName: null, clientEmail: null, address: null, city: null, state: null,
  zip: null, projectType: "remodel", channel: "premium", status: "estimate", leadId: null,
  jobtreadId: null, estimatedTotal: null, actualTotal: null, variancePct: null,
  startDate: null, endDate: null, notes: null, county: null, zone: ZONE, region: null,
  finishLevel: null, pricingSchemaVersion: null, zoneModifierSnapshot: null,
  geocodeConfidence: null, geocodeSource: null, geocodedAddress: null, geocodedAt: null,
  clientType: null, commercialChannel: null, sourceChannel: null, addressNormalized: null,
  latitude: null, longitude: null, geoWarnings: null, geoRiskClass: null, updatedBy: null,
  varianceThresholdPct: "10", committedCostCents: 0, approvedBudgetCents: null,
  changeOrderBudgetCents: 0, fieldStartedAt: null, fieldCompletedAt: null, closedAt: null,
  calibratedAt: null, scopeCompletenessScore: null, realizedGrossProfitPct: null,
  deletedAt: null, createdAt: NOW, updatedAt: NOW,
};
const draft: ScopeDraft = {
  id: DRAFT, tenantId: TENANT_A, projectId: PROJECT, status: "approved", content: null,
  zone: ZONE, finishLevel: null, serviceType: null, channel: null, confidence: "0.90",
  reason: null, intakeFormId: null, createdBy: ACTOR, retryCount: 0, warningsJson: [],
  geoWarnings: null, geoRiskClass: null, previsitBriefId: null, approvedBy: ACTOR,
  approvedAt: NOW, rejectedBy: null, rejectedAt: null, rejectionReason: null,
  createdAt: NOW, updatedAt: NOW,
};
const item: ScopeDraftItem = {
  id: "d2800000-0000-4000-8000-000000000002", scopeDraftId: DRAFT, costCodeId: null,
  assemblyId: ORIGINAL, assemblyName: "Ordinary electrical assembly", quantity: "2",
  unit: "EA", reason: "Synthetic scope", confidence: "0.90", overrideType: null,
  notes: null, sortOrder: 0, createdAt: NOW, updatedAt: NOW,
};
function assembly(id: string, name: string): Assembly {
  return {
    id, tenantId: TENANT_A, name, description: null, category: "electrical",
    defaultUnitId: null, baseUnitQty: "1.00", wasteFactor: "0.10", region: "charleston_sc",
    code: id === ORIGINAL ? "EL-BASE" : "EL-COAST", trade: "electrical", finishLevel: null,
    coastalModifier: null, isActive: true, createdAt: NOW, updatedAt: NOW,
  };
}
const rule: GeographicOverride = {
  id: RULE, tenantId: TENANT_A, zoneId: null, assemblyId: null, costCodeId: null,
  overrideType: "swap", overrideValue: null, reason: null, zone: ZONE, trade: "electrical",
  finishLevel: null, reasonTemplate: "Use {replacement} in {zone}",
  originalAssemblyId: ORIGINAL, replacementAssemblyId: REPLACEMENT,
  isActive: true, createdAt: NOW, updatedAt: NOW,
};

type StoredRow = Record<string, unknown>;
const store: Record<string, StoredRow[]> = {};
const events: string[] = [];
const lookups: Array<{ table: string; id: unknown; returned: StoredRow[] }> = [];
let contentDraft: ScopeDraft;

// Lookup by PRIMARY KEY ONLY. Foreign/NULL/deleted rows are returned unchanged;
// real application guards must make every authorization decision themselves.
const driver = {
  select: () => ({ from: (table: Table) => ({ where: (predicate: SQL) => ({
    limit: async (count: number) => {
      const name = getTableName(table);
      const query = new PgDialect().sqlToQuery(predicate);
      if (query.sql !== `"${name}"."id" = $1` || query.params.length !== 1) {
        throw new Error("Characterization fixture expects the current PK-only lookup");
      }
      const id = query.params[0];
      const returned = structuredClone((store[name] ?? []).filter(row => row.id === id).slice(0, count));
      events.push(`guard:${name}`);
      lookups.push({ table: name, id, returned });
      return returned;
    },
  }) }) }),
  insert: boundary.insert, update: boundary.update, delete: boundary.delete, transaction: boundary.transaction,
};

function context(): TrpcContext {
  return {
    req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "supabase",
    tenantId: TENANT_A, user: { ...actor },
  };
}
const invoke = () => geoOverrideRouter.createCaller(context()).previewForDraft({ scopeDraftId: DRAFT, projectZone: ZONE });
const guardEvents = ["guard:scope_drafts", "guard:projects", "guard:profiles"];
function expectNoEffects() {
  for (const sink of [boundary.audit, boundary.writeLog, boundary.insert, boundary.update, boundary.delete, boundary.transaction]) {
    expect(sink).not.toHaveBeenCalled();
  }
}
function expectNoContentReads() {
  for (const reader of [boundary.draft, boundary.effectiveItems, boundary.assemblies, boundary.rules]) {
    expect(reader).not.toHaveBeenCalled();
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  events.length = 0;
  lookups.length = 0;
  contentDraft = structuredClone(draft);
  store.scope_drafts = [{ ...contentDraft }];
  store.projects = [{ ...project }];
  store.profiles = [{ ...actor }];
  boundary.getDb.mockResolvedValue(driver);
  boundary.permission.mockResolvedValue(false);
  boundary.draft.mockImplementation(async () => {
    events.push("content:draft");
    return { draft: structuredClone(contentDraft), items: [structuredClone(item)] };
  });
  boundary.effectiveItems.mockImplementation(async () => { events.push("content:items"); return [structuredClone(item)]; });
  boundary.assemblies.mockImplementation(async () => {
    events.push("catalog:assemblies");
    return { items: [assembly(ORIGINAL, "Ordinary electrical assembly"), assembly(REPLACEMENT, "Coastal electrical assembly")], total: 2 };
  });
  boundary.rules.mockImplementation(async () => { events.push("rules"); return [structuredClone(rule)]; });
  for (const sink of [boundary.insert, boundary.update, boundary.delete, boundary.transaction, boundary.writeLog, boundary.audit]) {
    sink.mockImplementation(() => { throw new Error("Preview attempted an unexpected mutation/audit"); });
  }
});
afterEach(() => vi.unstubAllEnvs());

type Scenario = {
  name: string; draftTenant: string | null; projectTenant: string | null;
  deleted: boolean; denied: "never" | "strict" | "always";
};
const scenarios: readonly Scenario[] = [
  { name: "own draft / own active project (control)", draftTenant: TENANT_A, projectTenant: TENANT_A, deleted: false, denied: "never" },
  { name: "foreign draft / own active project — characterizes current acceptance; unresolved policy", draftTenant: TENANT_B, projectTenant: TENANT_A, deleted: false, denied: "never" },
  { name: "NULL-tenant draft / own active project — characterizes current acceptance; unresolved policy", draftTenant: null, projectTenant: TENANT_A, deleted: false, denied: "never" },
  { name: "own draft / own deleted project — characterizes current acceptance; unresolved policy", draftTenant: TENANT_A, projectTenant: TENANT_A, deleted: true, denied: "never" },
  { name: "own draft / NULL-tenant project — strict-off characterizes current acceptance; unresolved policy", draftTenant: TENANT_A, projectTenant: null, deleted: false, denied: "strict" },
  { name: "own draft / foreign project (denial control)", draftTenant: TENANT_A, projectTenant: TENANT_B, deleted: false, denied: "always" },
];

describe.each(["false", "true"])("preview parent characterization · TENANT_STRICT=%s", strict => {
  beforeEach(() => vi.stubEnv("TENANT_STRICT", strict));

  it.each(scenarios)("$name", async scenario => {
    contentDraft = { ...draft, tenantId: scenario.draftTenant };
    store.scope_drafts = [{ ...contentDraft }];
    store.projects = [{ ...project, tenantId: scenario.projectTenant, deletedAt: scenario.deleted ? NOW : null }];
    const initial = structuredClone(store);
    const denied = scenario.denied === "always" || (scenario.denied === "strict" && strict === "true");
    if (denied) {
      await expect(invoke()).rejects.toMatchObject({ code: "FORBIDDEN" });
      expectNoContentReads();
      expect(events).toEqual(guardEvents);
    } else {
      const result = await invoke();
      expect(result.hasOverrides).toBe(true);
      expect(result.resolvedItems.map(value => [value.assemblyId, value.quantity])).toEqual([[REPLACEMENT, 2]]);
      expect(result.overrides.map(value => [value.ruleId, value.originalAssemblyId, value.replacementAssemblyId, value.overrideType]))
        .toEqual([[RULE, ORIGINAL, REPLACEMENT, "swap"]]);
      expect(result.stats).toMatchObject({ rulesEvaluated: 1, rulesMatched: 1, swapsApplied: 1, additionsApplied: 0 });
      expect(boundary.rules).toHaveBeenCalledTimes(1);
      expect(boundary.rules).toHaveBeenCalledWith(TENANT_A, { activeOnly: true });
      expect(boundary.draft).toHaveBeenCalledTimes(1);
      expect(boundary.draft).toHaveBeenCalledWith(DRAFT);
      expect(boundary.effectiveItems).toHaveBeenCalledTimes(1);
      expect(boundary.effectiveItems).toHaveBeenCalledWith(DRAFT);
      expect(boundary.assemblies).toHaveBeenCalledTimes(1);
      expect(boundary.assemblies).toHaveBeenCalledWith({ activeOnly: true, limit: 2000 });
      expect(events).toEqual([...guardEvents, "content:draft", "content:items", "catalog:assemblies", "rules"]);
      // The returned content is the same draft used by the real parent resolver,
      // including the tenant values whose current treatment is being measured.
      await expect(boundary.draft.mock.results[0].value).resolves.toMatchObject({ draft: initial.scope_drafts[0] });
    }
    expect(lookups.map(value => [value.table, value.id])).toEqual([
      ["scope_drafts", DRAFT], ["projects", PROJECT], ["profiles", ACTOR],
    ]);
    expect(lookups[0].returned).toEqual(initial.scope_drafts);
    expect(lookups[1].returned).toEqual(initial.projects);
    expect(store).toEqual(initial);
    expect(boundary.permission).not.toHaveBeenCalled();
    expectNoEffects();
  });

  it("rejects a missing draft before project/content/catalog/rule access", async () => {
    store.scope_drafts = [];
    await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(events).toEqual(["guard:scope_drafts"]);
    expect(lookups).toEqual([{ table: "scope_drafts", id: DRAFT, returned: [] }]);
    expectNoContentReads();
    expectNoEffects();
  });

  it("rejects a missing project before profile/content/catalog/rule access", async () => {
    store.projects = [];
    await expect(invoke()).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(events).toEqual(["guard:scope_drafts", "guard:projects"]);
    expect(lookups.at(-1)).toEqual({ table: "projects", id: PROJECT, returned: [] });
    expectNoContentReads();
    expectNoEffects();
  });
});
