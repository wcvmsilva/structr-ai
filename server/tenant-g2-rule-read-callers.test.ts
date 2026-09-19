/**
 * G2 rule-reader consumers: real routers, tenant middleware, parent access guard,
 * input normalization, override engine and remodel engine. Persistence boundaries
 * are explicit doubles. The authorization driver matches IDs only; it never
 * filters ownership. The rule readers accept both old and new call shapes and
 * return fixed rows, so RED must be an assertion about the caller, not a missing
 * method/signature error. SQL ownership belongs to the companion PostgreSQL proof.
 *
 * HISTORY: visualization callers now use the canonical UUID input contract; this is
 * a contract fixture update, not a new G2 rule-reader proof. The bootstrap case replaces
 * every seed collaborator and process.exit; it proves discovery context only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Assembly, GeographicOverride, Profile, Project, ScopeDraft, ScopeDraftItem } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const boundary = vi.hoisted(() => ({
  list: vi.fn(), counts: vi.fn(), create: vi.fn(), seed: vi.fn(), getLog: vi.fn(), writeLog: vi.fn(),
  draft: vi.fn(), effectiveItems: vi.fn(), assemblies: vi.fn(), project: vi.fn(),
  templates: vi.fn(), audit: vi.fn(), seedScope: vi.fn(), seedZones: vi.fn(), seedRemodel: vi.fn(),
}));

type Row = Record<string, unknown>;
const store: Record<string, Row[]> = {};
const events: string[] = [];

// Only primary-key lookup is modeled. Tenant/role decisions stay in project-access.
const authorizationDriver = {
  select: () => ({ from: (table: Table) => ({ where: (predicate: SQL) => ({
    limit: async (count: number) => {
      const name = getTableName(table);
      const query = new PgDialect().sqlToQuery(predicate);
      const idParameter = /"[^\"]+"\."id" = \$(\d+)/.exec(query.sql);
      if (!idParameter) throw new Error("Caller fixture requires a primary-key lookup");
      const id = query.params[Number(idParameter[1]) - 1];
      events.push(`guard:${name}`);
      return structuredClone((store[name] ?? []).filter(row => row.id === id).slice(0, count));
    },
  }) }) }),
};

vi.mock("./db", () => ({ getDb: async () => authorizationDriver, getRawClient: vi.fn() }));
vi.mock("./rbac", () => ({ hasPermission: vi.fn(async () => false) }));
vi.mock("./audit", () => ({
  logAudit: boundary.audit,
  withAuditLog: vi.fn(async (_metadata: unknown, work: () => unknown) => work()),
}));
vi.mock("./geo-override-db", async importOriginal => ({
  ...await importOriginal<typeof import("./geo-override-db")>(),
  listOverrideRules: boundary.list,
  getOverrideCountsByZoneId: boundary.counts,
  getOverrideCountsByZone: boundary.counts,
  createOverrideRule: boundary.create,
  seedOverrideRulesForTenant: boundary.seed,
  getOverrideLogForDraft: boundary.getLog,
  writeOverrideLogEntries: boundary.writeLog,
}));
vi.mock("./scope-db", () => ({
  getScopeDraftWithItems: boundary.draft,
  listScopeDraftsForProject: vi.fn(),
  seedScopeRules: boundary.seedScope,
}));
vi.mock("./scope-review-db", () => ({ getEffectiveItems: boundary.effectiveItems }));
vi.mock("./assembly-db", () => ({ listAssemblies: boundary.assemblies }));
vi.mock("./project-db", () => ({ getProjectById: boundary.project }));
vi.mock("./geo-db", () => ({ seedCharlestonZones: boundary.seedZones }));
vi.mock("./remodel-db", () => ({
  listRemodelTemplates: boundary.templates,
  seedRemodelTemplates: boundary.seedRemodel,
  createRemodelTemplate: vi.fn(), getRemodelTemplateById: vi.fn(),
  updateRemodelTemplate: vi.fn(), deactivateRemodelTemplate: vi.fn(),
  reactivateRemodelTemplate: vi.fn(), getRemodelTemplateCountByServiceType: vi.fn(),
}));

import { router } from "./_core/trpc";
import { geoOverrideRouter } from "./geo-override-router";
import { remodelRouter } from "./remodel-router";
import { workflowVisualizationRouter } from "./workflow-visualization-router";

const TENANT_A = "a2500000-0000-4000-8000-000000000001";
const TENANT_B = "a2500000-0000-4000-8000-000000000002";
const ACTOR = "b2500000-0000-4000-8000-000000000001";
const PROJECT = "c2500000-0000-4000-8000-000000000001";
const DRAFT = "d2500000-0000-4000-8000-000000000001";
const ORIGINAL = "e2500000-0000-4000-8000-000000000001";
const REPLACEMENT = "e2500000-0000-4000-8000-000000000002";
const RULE = "f2500000-0000-4000-8000-000000000001";
const ZONE = "Charleston Coastal";
const NOW = new Date("2026-09-15T21:00:00.000Z");

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
  id: "d2500000-0000-4000-8000-000000000002", scopeDraftId: DRAFT, costCodeId: null,
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

const api = router({ geoOverride: geoOverrideRouter, remodel: remodelRouter, workflowViz: workflowVisualizationRouter });
type Caller = ReturnType<typeof api.createCaller>;
type Invocation = (caller: Caller) => Promise<unknown>;
const consumers: ReadonlyArray<readonly [string, Invocation]> = [
  ["listRules", caller => caller.geoOverride.listRules({ activeOnly: true })],
  ["statsByZone", caller => caller.geoOverride.statsByZone()],
  ["resolveForDraft", caller => caller.geoOverride.resolveForDraft({ scopeDraftId: DRAFT, projectZone: ZONE, persistLog: false })],
  ["previewForDraft", caller => caller.geoOverride.previewForDraft({ scopeDraftId: DRAFT, projectZone: ZONE })],
  ["generateWorkflow", caller => caller.remodel.generateWorkflow({ scopeDraftId: DRAFT })],
  ["loadVisualization", caller => caller.workflowViz.loadVisualization({ scopeDraftId: DRAFT })],
];
const parentConsumers = consumers.slice(2);

function context(role: "admin" | "user" | null = "user", tenantId: string | null = TENANT_A): TrpcContext {
  return {
    req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "supabase",
    user: role === null ? null : { ...actor, role }, tenantId,
  };
}
function expectNoRuleRead() {
  expect(boundary.list).not.toHaveBeenCalled();
  expect(boundary.counts).not.toHaveBeenCalled();
  expect(boundary.writeLog).not.toHaveBeenCalled();
  expect(boundary.create).not.toHaveBeenCalled();
  expect(boundary.seed).not.toHaveBeenCalled();
}

async function runSeedDiscovery(): Promise<number> {
  vi.resetModules();
  vi.stubEnv("SEED_TENANT_ID", ` ${TENANT_A} `);
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>(resolve => { resolveExit = resolve; });
  vi.spyOn(process, "exit").mockImplementation(code => { resolveExit(Number(code ?? 0)); return undefined as never; });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await import("./seed");
  return exited;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TENANT_STRICT", "false");
  events.length = 0;
  store.profiles = [{ ...actor }];
  store.projects = [{ ...project }];
  store.scope_drafts = [{ ...draft }];
  // These readers intentionally do not inspect or enforce tenant arguments.
  boundary.list.mockImplementation(async (..._args: unknown[]) => {
    events.push("list");
    return structuredClone([rule]);
  });
  boundary.counts.mockImplementation(async (..._args: unknown[]) => {
    events.push("counts");
    return [{ zoneId: null, count: 1 }];
  });
  boundary.draft.mockResolvedValue({ draft: structuredClone(draft), items: [structuredClone(item)] });
  boundary.effectiveItems.mockResolvedValue([structuredClone(item)]);
  boundary.assemblies.mockResolvedValue({
    items: [assembly(ORIGINAL, "Ordinary electrical assembly"), assembly(REPLACEMENT, "Coastal electrical assembly")],
    total: 2,
  });
  boundary.project.mockResolvedValue(structuredClone(project));
  boundary.templates.mockResolvedValue([]);
  boundary.getLog.mockResolvedValue([]);
  boundary.writeLog.mockResolvedValue(0);
  boundary.create.mockResolvedValue(structuredClone(rule));
  boundary.seed.mockResolvedValue({ seeded: false, existingCount: 1 });
  boundary.audit.mockResolvedValue(undefined);
  boundary.seedScope.mockResolvedValue(0);
  boundary.seedZones.mockResolvedValue(0);
  boundary.seedRemodel.mockResolvedValue({ created: 0, updated: 0 });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("G2 consumer authentication and tenant boundary", () => {
  // Catches a route retaining protectedProcedure and letting role/profile tenant
  // substitute for the missing resolved request tenant.
  it.each(consumers)("%s denies missing request tenant even for admin with a provisioned profile", async (_name, invoke) => {
    store.profiles = [{ ...actor, role: "admin" }];
    await expect(invoke(api.createCaller(context("admin", null)))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoRuleRead();
    expect(boundary.draft).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
  it.each(consumers)("%s denies a missing user before rule access", async (_name, invoke) => {
    await expect(invoke(api.createCaller(context(null)))).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expectNoRuleRead();
    expect(events).toEqual([]);
  });
});

describe("G2 list and aggregate caller contracts", () => {
  it("listRules normalizes electric and keeps both filters while taking authority only from context", async () => {
    const input = { zone: ZONE, trade: "electric", activeOnly: false, tenantId: TENANT_B, userId: "spoofed", role: "admin" };
    const result = await api.createCaller(context()).geoOverride.listRules(input);
    expect(result.map(row => row.id)).toEqual([RULE]);
    expect(boundary.list).toHaveBeenCalledTimes(1);
    expect(boundary.list).toHaveBeenCalledWith(TENANT_A, { zone: ZONE, trade: "electrical", activeOnly: false });
    expect(boundary.counts).not.toHaveBeenCalled();
  });
  it("listRules without filters still sends the trusted tenant", async () => {
    const result = await api.createCaller(context()).geoOverride.listRules();
    expect(result.map(row => row.id)).toEqual([RULE]);
    expect(boundary.list).toHaveBeenCalledTimes(1);
    expect(boundary.list.mock.calls[0][0]).toBe(TENANT_A);
  });
  it("statsByZone scopes an admin aggregate without losing an owned NULL-zone group", async () => {
    const result = await api.createCaller(context("admin")).geoOverride.statsByZone();
    expect(result).toEqual([{ zoneId: null, count: 1 }]);
    expect(boundary.counts).toHaveBeenCalledTimes(1);
    expect(boundary.counts).toHaveBeenCalledWith(TENANT_A);
  });
});

describe("G2 parent guards remain ahead of rule readers", () => {
  // Driver returns the foreign row; real project-access must reject it.
  it.each(parentConsumers)("%s refuses a foreign parent before reading any rules", async (_name, invoke) => {
    store.profiles = [{ ...actor, role: "admin" }];
    store.projects = [{ ...project, tenantId: TENANT_B }];
    await expect(invoke(api.createCaller(context("admin")))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoRuleRead();
    expect(boundary.draft).not.toHaveBeenCalled();
    expect(events).toEqual(["guard:scope_drafts", "guard:projects", "guard:profiles"]);
  });
  // Legacy parent NULL tolerance must not replace request authority with NULL.
  it.each(parentConsumers)("%s keeps context A when the allowed parent has NULL tenant", async (_name, invoke) => {
    store.projects = [{ ...project, tenantId: null }];
    boundary.project.mockResolvedValue({ ...project, tenantId: null });
    const result = await invoke(api.createCaller(context()));
    expect(result).toBeDefined();
    expect(boundary.list).toHaveBeenCalledTimes(1);
    expect(boundary.list).toHaveBeenCalledWith(TENANT_A, { activeOnly: true });
    expect(events.indexOf("guard:profiles")).toBeLessThan(events.indexOf("list"));
    expect(boundary.writeLog).not.toHaveBeenCalled();
  });
});

describe("G2 real engine consumers", () => {
  // A failed rule read cannot produce an apparently successful empty workflow or
  // continue to template loading, audit completion, or override-log persistence.
  it.each(parentConsumers)("%s stops downstream work when its rule reader fails", async (_name, invoke) => {
    boundary.list.mockRejectedValue(new Error("Synthetic rule-reader failure"));
    await expect(invoke(api.createCaller(context()))).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(boundary.list).toHaveBeenCalledTimes(1);
    expect(boundary.templates).not.toHaveBeenCalled();
    expect(boundary.writeLog).not.toHaveBeenCalled();
    expect(boundary.create).not.toHaveBeenCalled();
    expect(boundary.audit).not.toHaveBeenCalled();
  });
  it.each(["preview", "resolve"] as const)("%s evaluates the supplied tenant rules and returns the coastal swap without writing an override log", async operation => {
    const input = { scopeDraftId: DRAFT, projectZone: ZONE, tenantId: TENANT_B, actorId: "spoofed" };
    const caller = api.createCaller(context());
    const result = operation === "preview"
      ? await caller.geoOverride.previewForDraft(input)
      : await caller.geoOverride.resolveForDraft({ ...input, persistLog: false });
    expect(result.resolvedItems.map(entry => [entry.assemblyId, entry.quantity])).toEqual([[REPLACEMENT, 2]]);
    expect(result.overrides.map(entry => entry.ruleId)).toEqual([RULE]);
    expect(result.stats).toMatchObject({ rulesEvaluated: 1, rulesMatched: 1, swapsApplied: 1, additionsApplied: 0 });
    expect(boundary.list).toHaveBeenCalledTimes(1);
    expect(boundary.list).toHaveBeenCalledWith(TENANT_A, { activeOnly: true });
    expect(boundary.writeLog).not.toHaveBeenCalled();
    if (operation === "preview") expect(boundary.audit).not.toHaveBeenCalled();
  });
  it("generateWorkflow passes the real override result into the real remodel output using context A", async () => {
    const input = { scopeDraftId: DRAFT, tenantId: TENANT_B, ownerUserId: "spoofed" };
    const result = await api.createCaller(context()).remodel.generateWorkflow(input);
    expect(result.orderedAssemblies.map(entry => [entry.assemblyId, entry.quantity])).toEqual([[REPLACEMENT, 2]]);
    expect(result.bundleSelections.map(entry => entry.assemblyId)).toEqual([REPLACEMENT]);
    expect(result.overrideResult?.stats).toMatchObject({ rulesEvaluated: 1, rulesMatched: 1, swapsApplied: 1 });
    expect(boundary.list).toHaveBeenCalledTimes(1);
    expect(boundary.list).toHaveBeenCalledWith(TENANT_A, { activeOnly: true });
    expect(boundary.writeLog).not.toHaveBeenCalled();
  });
  it("loadVisualization sends context A to the reader through its UUID input boundary", async () => {
    const input = { scopeDraftId: DRAFT, tenantId: TENANT_B, userId: "spoofed" };
    const result = await api.createCaller(context()).workflowViz.loadVisualization(input);
    expect(result.workflow.stages.flatMap(stage => stage.assemblies.map(entry => entry.assemblyId))).toEqual([REPLACEMENT]);
    expect(result.overrideSummary).toMatchObject({ hasOverrides: true, swapCount: 1, addCount: 0 });
    expect(boundary.list).toHaveBeenCalledTimes(1);
    expect(boundary.list).toHaveBeenCalledWith(TENANT_A, { activeOnly: true });
    expect(boundary.writeLog).not.toHaveBeenCalled();
  });
});

describe("G2 seed batch caller delegation (discovery is measured in the real-helper suite)", () => {
  it("seedCoastalRules does not report success after its batch helper fails", async () => {
    boundary.seed.mockRejectedValue(new Error("Synthetic batch failure"));
    await expect(api.createCaller(context("admin")).geoOverride.seedCoastalRules()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(boundary.seed).toHaveBeenCalledTimes(1);
    expect(boundary.list).not.toHaveBeenCalled();
    expect(boundary.create).not.toHaveBeenCalled();
    expect(boundary.audit).not.toHaveBeenCalled();
  });
  it("seedCoastalRules delegates tenant authority and translates a batch skip", async () => {
    const result = await api.createCaller(context("admin")).geoOverride.seedCoastalRules();
    expect(result.seeded).toBe(false);
    expect(result.message).toBe("1 override rules already exist. Clear existing rules before re-seeding.");
    expect(boundary.seed).toHaveBeenCalledTimes(1);
    expect(boundary.seed).toHaveBeenCalledWith(TENANT_A, expect.any(Array), ACTOR);
    expect(boundary.list).not.toHaveBeenCalled();
    expect(boundary.create).not.toHaveBeenCalled();
    expect(boundary.audit).not.toHaveBeenCalled();
  });
  it("seedCoastalRules still requires both admin and resolved tenant before discovery", async () => {
    await expect(api.createCaller(context("admin", null)).geoOverride.seedCoastalRules()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(api.createCaller(context("user")).geoOverride.seedCoastalRules()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoRuleRead();
  });
});

describe("G2 unchanged server bootstrap discovery", () => {
  it("server seed discovery receives the explicit trimmed SEED_TENANT_ID with every write collaborator replaced", async () => {
    await expect(runSeedDiscovery()).resolves.toBe(0);
    expect(boundary.list).toHaveBeenCalledTimes(1);
    expect(boundary.list).toHaveBeenCalledWith(TENANT_A, { activeOnly: false });
    expect(boundary.create).not.toHaveBeenCalled();
    expect(boundary.seed).not.toHaveBeenCalled();
  });
  it("server seed exits unsuccessfully and creates no coastal rule after discovery fails", async () => {
    boundary.list.mockRejectedValue(new Error("Synthetic discovery failure"));
    await expect(runSeedDiscovery()).resolves.toBe(1);
    expect(boundary.list).toHaveBeenCalledTimes(1);
    expect(boundary.create).not.toHaveBeenCalled();
    expect(boundary.seed).not.toHaveBeenCalled();
  });
});
