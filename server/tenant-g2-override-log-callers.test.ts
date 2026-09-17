/** G2 CALL boundary proof: real routers, middleware, project guard and override/remodel
 * engines. Commercial readers, log storage, recovery and pipeline execution are
 * explicit doubles. The real new preflight uses a controlled SELECT fixture; SQL,
 * persistence, locking and durable audit are proven only by the PG companion.
 * Same-api RED cases use existing tRPC routes and observable downstream calls.
 * No new export is imported at top level; missing signatures are not security RED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL, type Table } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Assembly, GeographicOverride, Profile, Project, ScopeDraft, ScopeDraftItem } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const boundary = vi.hoisted(() => ({
  pipeline: vi.fn(), partial: vi.fn(), getPartial: vi.fn(), retrying: vi.fn(), recovered: vi.fn(), abandon: vi.fn(), has: vi.fn(), clear: vi.fn(),
  list: vi.fn(), counts: vi.fn(), create: vi.fn(), getLog: vi.fn(), writeLog: vi.fn(),
  draft: vi.fn(), effectiveItems: vi.fn(), assemblies: vi.fn(), project: vi.fn(),
  templates: vi.fn(), audit: vi.fn(), seedScope: vi.fn(), seedZones: vi.fn(), seedRemodel: vi.fn(),
}));

type Row = Record<string, unknown>;
const store: Record<string, Row[]> = {};
const events: string[] = [];

// Declared SELECT double: real project-access runs primary-key lookups. Joined
// parent reads project synthetic rows by selected column; the local fixture gate
// is a controlled DB response, NOT proof of the SQL predicate or actual database.
const authorizationDriver = {
  select: (selection?: Record<string, any>) => {
    let source: string; let joined = false; let predicate: SQL;
    const evaluate = () => {
      const query = new PgDialect().sqlToQuery(predicate);
      const idParameter = /"[^\"]+"\."id" = \$(\d+)/.exec(query.sql);
      const id = idParameter ? query.params[Number(idParameter[1]) - 1] : undefined;
      events.push(`guard:${joined ? "parents" : source}`);
      if (!joined) return structuredClone((store[source] ?? []).filter(row => row.id === id));
      const d = (store.scope_drafts ?? []).find(row => row.id === id);
      const p = (store.projects ?? []).find(row => row.id === d?.projectId);
      // Existence only: this fixture answers WHICH rows exist, never whether the caller
      // may see them. No tenant, deletion or membership decision is taken here — the
      // production predicate and its verification decide, and the owned PostgreSQL
      // suite is what proves the SQL itself.
      if (!d || !p) return [];
      const projectSelection = (value: any): any => {
        if (value?.table && typeof value.name === "string") {
          const key = value.name.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
          return (getTableName(value.table) === "projects" ? p : d)[key];
        }
        if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, col]) => [key, projectSelection(col)]));
        return value;
      };
      return [projectSelection(selection)];
    };
    const chain: any = {
      from: (table: Table) => { source = getTableName(table); return chain; },
      innerJoin: () => { joined = true; return chain; },
      leftJoin: () => { joined = true; return chain; },
      where: (p: SQL) => { predicate = p; return chain; },
      limit: async (count: number) => evaluate().slice(0, count),
      then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(evaluate).then(resolve, reject),
    };
    return chain;
  },
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
  getOverrideLogForDraft: boundary.getLog,
  writeOverrideLogEntries: boundary.writeLog,
  hasOverridesApplied: boundary.has, clearOverrideLogForDraft: boundary.clear,
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

vi.mock("./scope-to-estimate-pipeline", async importOriginal => ({
  ...await importOriginal<typeof import("./scope-to-estimate-pipeline")>(),
  executeScopeToEstimatePipeline: boundary.pipeline,
}));
vi.mock("./draft-recovery-db", () => ({
  createPartialDraft: boundary.partial, getPartialDraftById: boundary.getPartial,
  markPartialDraftRetrying: boundary.retrying, markPartialDraftRecovered: boundary.recovered,
  abandonPartialDraft: boundary.abandon, listPartialDrafts: vi.fn(), getPartialDraftStats: vi.fn(),
}));
import { estimateRouter } from "./estimate-router";
import { PipelineError } from "./scope-to-estimate-pipeline";
import { TRPCError } from "@trpc/server";
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

const PARTIAL = "d2500000-0000-4000-8000-000000000003";
const authority = { tenantId: TENANT_A, userId: ACTOR };
const api = router({ geoOverride: geoOverrideRouter, remodel: remodelRouter, workflowViz: workflowVisualizationRouter, estimate: estimateRouter });
type Caller = ReturnType<typeof api.createCaller>;
type Invocation = (caller: Caller) => Promise<unknown>;
// HISTORY: visualization callers use the canonical UUID input contract; these are
// fixture adaptations for this consumer suite, not new override-history proofs.
const consumers: ReadonlyArray<readonly [string, Invocation]> = [
  ["getLog", c => c.geoOverride.getLog({ scopeDraftId: DRAFT })],
  ["hasOverrides", c => c.geoOverride.hasOverrides({ scopeDraftId: DRAFT })],
  ["clearLog", c => c.geoOverride.clearLog({ scopeDraftId: DRAFT })],
  ["resolveForDraft", c => c.geoOverride.resolveForDraft({ scopeDraftId: DRAFT, projectZone: ZONE, persistLog: true })],
  ["generateWorkflow", c => c.remodel.generateWorkflow({ scopeDraftId: DRAFT })],
  ["loadVisualization", c => c.workflowViz.loadVisualization({ scopeDraftId: DRAFT })],
  ["createFromScopeDraft", c => c.estimate.createFromScopeDraft({ scopeDraftId: DRAFT })],
  ["retryPartialDraft", c => c.estimate.retryPartialDraft({ id: PARTIAL })],
];
function context(role: "admin" | "user" | null = "user", tenantId: string | null = TENANT_A): TrpcContext {
  return { req: {} as TrpcContext["req"], res: {} as TrpcContext["res"], authProvider: "supabase", user: role === null ? null : { ...actor, role }, tenantId };
}
function expectNoBusiness() {
  for (const fn of [boundary.draft, boundary.list, boundary.getLog, boundary.writeLog, boundary.has, boundary.clear, boundary.pipeline, boundary.partial, boundary.retrying, boundary.recovered, boundary.audit]) expect(fn).not.toHaveBeenCalled();
}
function partial(scopeDraftId: string | null = DRAFT) {
  return { id: PARTIAL, scopeDraftId, userId: ACTOR, status: "pending", contextSnapshot: { tenantId: TENANT_B, userId: "forged", role: "admin", draftName: "Restored name" } };
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("TENANT_STRICT", "false"); events.length = 0;
  store.profiles = [{ ...actor }]; store.projects = [{ ...project }];
  store.scope_drafts = [{ ...draft }];
  boundary.list.mockResolvedValue([structuredClone(rule)]);
  boundary.draft.mockResolvedValue({ draft: structuredClone(draft), items: [structuredClone(item)] });
  boundary.effectiveItems.mockResolvedValue([structuredClone(item)]);
  boundary.assemblies.mockResolvedValue({ items: [assembly(ORIGINAL, "Ordinary electrical assembly"), assembly(REPLACEMENT, "Coastal electrical assembly")], total: 2 });
  boundary.project.mockResolvedValue(structuredClone(project)); boundary.templates.mockResolvedValue([]);
  boundary.getLog.mockResolvedValue([]); boundary.writeLog.mockResolvedValue(1);
  boundary.has.mockResolvedValue(false); boundary.clear.mockResolvedValue(0);
  boundary.audit.mockResolvedValue(null);
  boundary.pipeline.mockImplementation(async () => { events.push("pipeline"); return { draft: { id: "estimate-created" }, batchSummary: {}, created: true }; });
  boundary.partial.mockResolvedValue({ id: PARTIAL }); boundary.getPartial.mockResolvedValue(partial());
  boundary.retrying.mockImplementation(async () => { events.push("retrying"); return { id: PARTIAL }; });
  boundary.recovered.mockImplementation(async () => { events.push("recovered"); return {}; });
  boundary.abandon.mockResolvedValue({ ...partial(null), status: "abandoned" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("same-api tenant/authentication boundaries", () => {
  it.each(consumers)("%s rejects absent tenant before business calls even for provisioned admin", async (_name, invoke) => {
    store.profiles = [{ ...actor, role: "admin" }];
    const outcome = await invoke(api.createCaller(context("admin", null))).then(value => ({ value }), error => ({ error }));
    expect.soft(outcome).toMatchObject({ error: { code: "FORBIDDEN" } });
    expectNoBusiness();
  });
  it.each(consumers)("%s rejects missing user before business calls", async (_name, invoke) => {
    await expect(invoke(api.createCaller(context(null)))).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expectNoBusiness();
  });
});
describe("same-api create and retry initial denial side effects", () => {
  it.each(["project-null", "draft-foreign"])("create refuses %s before commercial recovery", async fixture => {
    if (fixture === "project-null") store.projects[0].tenantId = null;
    else store.scope_drafts[0].tenantId = TENANT_B;
    boundary.pipeline.mockRejectedValue(new PipelineError("NO_EFFECTIVE_ITEMS", "items", "Synthetic commercial failure"));
    const outcome = await api.createCaller(context()).estimate.createFromScopeDraft({ scopeDraftId: DRAFT }).then(value => ({ value }), error => ({ error }));
    expect.soft(outcome).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect.soft(boundary.pipeline).not.toHaveBeenCalled();
    expect(boundary.partial).not.toHaveBeenCalled();
  });
  it.each(["project-null", "draft-foreign"])("retry refuses %s before marking retrying", async fixture => {
    if (fixture === "project-null") store.projects[0].tenantId = null;
    else store.scope_drafts[0].tenantId = TENANT_B;
    const outcome = await api.createCaller(context()).estimate.retryPartialDraft({ id: PARTIAL }).then(value => ({ value }), error => ({ error }));
    expect.soft(outcome).toMatchObject({ error: { code: "FORBIDDEN" } });
    expect.soft(boundary.retrying).not.toHaveBeenCalled(); expect.soft(boundary.pipeline).not.toHaveBeenCalled(); expect(boundary.recovered).not.toHaveBeenCalled();
  });
  it("own parentless partial remains readable/abandonable but retry fails before mutation", async () => {
    boundary.getPartial.mockResolvedValue(partial(null));
    const caller = api.createCaller(context());
    await expect(caller.estimate.getPartialDraft({ id: PARTIAL })).resolves.toMatchObject({ scopeDraftId: null });
    await expect(caller.estimate.abandonPartialDraft({ id: PARTIAL })).resolves.toMatchObject({ status: "abandoned" });
    const outcome = await caller.estimate.retryPartialDraft({ id: PARTIAL }).then(value => ({ value }), error => ({ error }));
    expect.soft(outcome).toMatchObject({ error: { code: "BAD_REQUEST" } });
    expect.soft(boundary.retrying).not.toHaveBeenCalled(); expect.soft(boundary.pipeline).not.toHaveBeenCalled(); expect(boundary.recovered).not.toHaveBeenCalled();
  });
});
describe("authorized recovery controls and current authority", () => {
  it("commercial PipelineError after positive preflight still creates a partial", async () => {
    boundary.pipeline.mockRejectedValue(new PipelineError("NO_EFFECTIVE_ITEMS", "items", "Synthetic commercial failure", { partial: true }));
    await expect(api.createCaller(context()).estimate.createFromScopeDraft({ scopeDraftId: DRAFT })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(boundary.partial).toHaveBeenCalledWith(expect.objectContaining({ scopeDraftId: DRAFT, userId: ACTOR, errorCode: "NO_EFFECTIVE_ITEMS", partialPayload: { partial: true } }));
  });
  it("create passes only current context authority, ignoring forged payload identity", async () => {
    await api.createCaller(context()).estimate.createFromScopeDraft({ scopeDraftId: DRAFT, tenantId: TENANT_B, userId: "forged" } as any);
    expect(boundary.pipeline).toHaveBeenCalledWith(expect.objectContaining({ scopeDraftId: DRAFT }), authority);
    expect(boundary.partial).not.toHaveBeenCalled();
  });
  it("retry uses current authority and recovers only after pipeline succeeds", async () => {
    const result = await api.createCaller(context()).estimate.retryPartialDraft({ id: PARTIAL });
    expect(result.recovered).toBe(true);
    expect(boundary.pipeline).toHaveBeenCalledWith(expect.objectContaining({ scopeDraftId: DRAFT, draftName: "Restored name" }), authority);
    expect(events.filter(e => ["retrying", "pipeline", "recovered"].includes(e))).toEqual(["retrying", "pipeline", "recovered"]);
    expect(boundary.recovered).toHaveBeenCalledWith(PARTIAL, "estimate-created", ACTOR); expect(boundary.partial).not.toHaveBeenCalled();
  });
  it("later authorization denial preserves its safe error without recovered or new partial; retrying already occurred", async () => {
    boundary.pipeline.mockRejectedValue(new TRPCError({ code: "FORBIDDEN", message: "Override history is unavailable for this draft" }));
    await expect(api.createCaller(context()).estimate.retryPartialDraft({ id: PARTIAL })).rejects.toMatchObject({ code: "FORBIDDEN", message: "Override history is unavailable for this draft" });
    expect(boundary.retrying).toHaveBeenCalledOnce(); expect(boundary.recovered).not.toHaveBeenCalled(); expect(boundary.partial).not.toHaveBeenCalled();
  });
  it("commercial retry failure retains existing recovery behavior without another partial", async () => {
    boundary.pipeline.mockRejectedValue(new PipelineError("NO_EFFECTIVE_ITEMS", "items", "Synthetic commercial failure"));
    await expect(api.createCaller(context()).estimate.retryPartialDraft({ id: PARTIAL })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(boundary.retrying).toHaveBeenCalledOnce(); expect(boundary.recovered).not.toHaveBeenCalled(); expect(boundary.partial).not.toHaveBeenCalled();
  });
});
describe("caller handoff and real engine mapper", () => {
  it("getLog/has/clear take authority from context and preserve admin restriction", async () => {
    const input = { scopeDraftId: DRAFT, tenantId: TENANT_B, userId: "forged" };
    const caller = api.createCaller(context("admin"));
    await caller.geoOverride.getLog(input); await caller.geoOverride.hasOverrides(input); await caller.geoOverride.clearLog(input);
    expect(boundary.getLog).toHaveBeenCalledWith(authority, DRAFT, "read");
    expect(boundary.has).toHaveBeenCalledWith(authority, DRAFT); expect(boundary.clear).toHaveBeenCalledWith(authority, DRAFT);
    boundary.clear.mockClear();
    await expect(api.createCaller(context()).geoOverride.clearLog(input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(boundary.clear).not.toHaveBeenCalled();
  });
  it.each([["resolve", "write"], ["remodel", "write"], ["visualization", "read"]] as const)("%s passes its purpose permission and trusted identity", async (which, permission) => {
    const caller = api.createCaller(context());
    if (which === "resolve") await caller.geoOverride.resolveForDraft({ scopeDraftId: DRAFT, projectZone: ZONE, persistLog: false });
    else if (which === "remodel") await caller.remodel.generateWorkflow({ scopeDraftId: DRAFT });
    else await caller.workflowViz.loadVisualization({ scopeDraftId: DRAFT });
    expect(boundary.getLog).toHaveBeenCalledWith(authority, DRAFT, permission); expect(boundary.writeLog).not.toHaveBeenCalled();
  });
  it("mapper persists ruleId and rendered reason with original rule/history snapshots", async () => {
    const result = await api.createCaller(context()).geoOverride.resolveForDraft({ scopeDraftId: DRAFT, projectZone: ZONE, persistLog: true });
    expect(result.overrides[0].ruleId).toBe(RULE);
    expect(boundary.writeLog).toHaveBeenCalledWith(authority, DRAFT, {
      expectedProjectId: PROJECT, expectedHistory: [], expectedRules: [rule],
      entries: [{ overrideId: RULE, originalAssemblyId: ORIGINAL, replacementAssemblyId: REPLACEMENT, overrideType: "swap", reason: result.overrides[0].overrideReason }],
    });
    expect(result.overrides[0].overrideReason).toContain("Coastal electrical assembly");
    expect(boundary.writeLog.mock.invocationCallOrder[0]).toBeLessThan(boundary.audit.mock.invocationCallOrder[0]);
  });
  it.each([true, false])("persistLog=%s with no matching rules controls empty writer call", async persistLog => {
    boundary.list.mockResolvedValue([]);
    await api.createCaller(context()).geoOverride.resolveForDraft({ scopeDraftId: DRAFT, projectZone: ZONE, persistLog });
    if (persistLog) expect(boundary.writeLog).toHaveBeenCalledWith(authority, DRAFT, { expectedProjectId: PROJECT, expectedHistory: [], expectedRules: [], entries: [] });
    else expect(boundary.writeLog).not.toHaveBeenCalled();
  });
  it("persistLog true still validates empty entries when history caused an already-applied result", async () => {
    const history = [{ id: "history", scopeDraftId: DRAFT, overrideId: RULE, originalAssemblyId: ORIGINAL, replacementAssemblyId: REPLACEMENT, overrideType: "swap", reason: "old reason", createdAt: NOW }];
    boundary.getLog.mockResolvedValue(history);
    const result = await api.createCaller(context()).geoOverride.resolveForDraft({ scopeDraftId: DRAFT, projectZone: ZONE, persistLog: true });
    expect(result.overrides.every(o => o.skippedBecauseAlreadyApplied)).toBe(true);
    expect(boundary.writeLog).toHaveBeenCalledWith(authority, DRAFT, { expectedProjectId: PROJECT, expectedHistory: history, expectedRules: [rule], entries: [] });
  });
  it.each(["CONFLICT", "INTERNAL_SERVER_ERROR"] as const)("writer %s prevents resolve_complete and successful result", async code => {
    boundary.writeLog.mockRejectedValue(new TRPCError({ code, message: "Synthetic writer failure" }));
    await expect(api.createCaller(context()).geoOverride.resolveForDraft({ scopeDraftId: DRAFT, projectZone: ZONE, persistLog: true })).rejects.toMatchObject({ code });
    expect(boundary.audit).not.toHaveBeenCalled();
  });
});
