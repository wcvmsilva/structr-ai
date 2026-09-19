/**
 * PIPE boundary: the real scope → estimate pipeline with named commercial doubles.
 *
 * Real: the pipeline module itself, its ordering, its error translation and the
 * Profit Shield / remodel step codes it consumes. Declared doubles: scope draft
 * loading, effective items, project and geo context, pre-visit, assembly catalog,
 * pricing dimensions, the assembly/estimate engines, estimate persistence, the audit
 * sink, and the two history collaborators (authorization preflight and reader).
 *
 * This file proves ORDER and ARGUMENT contracts inside the pipeline. It proves no SQL,
 * no locking and no durable audit — those belong to the owned PostgreSQL suite. The
 * preflight is a new export the base never calls, so these are candidate-contract
 * cases; the same-api contrast for create/retry lives in the callers suite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";

const PROJECT = "33333333-3333-4333-8333-333333333333";
const TENANT = "44444444-4444-4444-8444-444444444444";
const USER = "22222222-2222-4222-8222-222222222222";
const DRAFT = "55555555-5555-4555-8555-555555555555";
const PLAIN_ASSEMBLY = "asm-1";
const REPLACED_ASSEMBLY = "asm-2";
const authority = { tenantId: TENANT, userId: USER };

const state = vi.hoisted(() => ({
  scopeDraft: null as Record<string, unknown> | null,
  effectiveItems: [] as Array<Record<string, unknown>>,
  project: null as Record<string, unknown> | null,
  previsit: null as { brief: Record<string, unknown> } | null,
  geoContext: null as Record<string, unknown> | null,
  existingEstimates: [] as Array<Record<string, unknown>>,
  createdDrafts: [] as Array<Record<string, unknown>>,
  selections: [] as Array<Record<string, unknown>>,
}));

const collaborator = vi.hoisted(() => ({
  preflight: vi.fn(),
  history: vi.fn(),
  scopeDraft: vi.fn(),
  effectiveItems: vi.fn(),
  existing: vi.fn(),
  persist: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({ from: () => ({ where: () => collaborator.existing() }) }),
  })),
  createEstimateDraft: vi.fn(async (payload: Record<string, unknown>) => {
    collaborator.persist(payload);
    const draft = { id: `est-${state.createdDrafts.length + 1}`, status: "draft", ...payload };
    state.createdDrafts.push(draft);
    return draft;
  }),
}));
vi.mock("./audit", () => ({ logAudit: collaborator.audit }));
vi.mock("./scope-db", () => ({ getScopeDraftById: collaborator.scopeDraft }));
vi.mock("./scope-review-db", () => ({ getEffectiveItems: collaborator.effectiveItems }));
vi.mock("./project-db", () => ({ getProjectById: vi.fn(async () => state.project) }));
vi.mock("./assembly-db", () => ({
  getAssemblyById: vi.fn(async (id: string) => ({
    id, name: `Assembly ${id}`, category: "Interior Finishes", isActive: true,
    components: [{
      id: "c1", componentType: "material", description: "Oak flooring", quantity: 100,
      unit: "SF", wasteFactor: 0.1, unitCostOverride: null,
      priceBookItem: {
        id: "pb1", name: "Oak flooring", unitCost: "4.50", unitPrice: "10.00",
        wasteFactor: "0.10", coastalModifier: null, itemType: "material",
      },
    }],
  })),
}));
vi.mock("./pricing-dimensions", () => ({
  resolvePricingDimensions: vi.fn(async () => ({
    channelCostMultiplier: 1, channelPriceMultiplier: 1, finishPriceMultiplier: 1,
    regionalCostModifier: 1, regionalLaborModifier: 1, regionalMaterialModifier: 1,
    regionalPermitModifier: 1, sources: { channel: "db", finish: "db", regional: "db" },
  })),
  toPricingEngineDimensions: vi.fn(() => ({})),
}));
// The candidate exports are declared here; on the base the spread simply provides the
// existing module and these keys are never reached, which is itself part of the record.
vi.mock("./geo-override-db", async importOriginal => ({
  ...await importOriginal<typeof import("./geo-override-db")>(),
  requireScopeOverrideLogAccess: collaborator.preflight,
  getOverrideLogForDraft: collaborator.history,
}));
vi.mock("./lead-conversion", () => ({ getProjectGeoContext: vi.fn(async () => state.geoContext) }));
vi.mock("./previsit-db", () => ({ getLatestBriefForProject: vi.fn(async () => state.previsit) }));
vi.mock("@shared/assembly-engine", () => ({
  calculateMultipleAssemblies: vi.fn(() => ({
    assemblies: state.effectiveItems.map(item => ({
      assemblyId: item.assemblyId, assemblyName: `Assembly ${item.assemblyId}`,
      grossProfitPct: 45, totalCost: 550, totalPrice: 1000, components: [],
    })),
    totalCost: 550, totalPrice: 1000, grossProfitPct: 45, meetsMinGP: true,
  })),
}));
vi.mock("@shared/estimate-engine", () => ({
  validateEstimateDraftInputs: vi.fn(() => []),
  transformBatchToEstimateDraft: vi.fn(() => ({
    metadata: {}, assemblySelections: structuredClone(state.selections), lineItems: [],
  })),
}));

import { executeScopeToEstimatePipeline, PipelineError } from "./scope-to-estimate-pipeline";

const denial = () => new TRPCError({ code: "FORBIDDEN", message: "Override history is unavailable for this draft" });
const run = (overrides: Record<string, unknown> = {}) =>
  (executeScopeToEstimatePipeline as unknown as (input: unknown, authority: unknown) => Promise<any>)(
    { scopeDraftId: DRAFT, ...overrides }, authority,
  );
const outcome = <T>(work: Promise<T>) => work.then(value => ({ value, error: null as any }), error => ({ value: null, error }));

beforeEach(() => {
  vi.clearAllMocks();
  state.scopeDraft = { id: DRAFT, status: "approved", projectId: PROJECT };
  state.effectiveItems = [
    { assemblyId: PLAIN_ASSEMBLY, quantity: 1, reason: null },
    { assemblyId: REPLACED_ASSEMBLY, quantity: 1, reason: null },
  ];
  state.project = { id: PROJECT, name: "Whitfield Remodel", channel: "direct", commercialChannel: "premium", zone: "West Ashley" };
  state.previsit = { brief: { id: "brief-1", nextStep: "conceptual_estimate", status: "completed" } };
  state.geoContext = { zoneName: "West Ashley", riskClass: "inland", warnings: [], codes: [], reliable: true, zoneMinProfitShieldPct: null };
  state.existingEstimates = [];
  state.createdDrafts = [];
  state.selections = [{ assemblyId: PLAIN_ASSEMBLY }, { assemblyId: REPLACED_ASSEMBLY }];
  collaborator.preflight.mockResolvedValue({ tenantId: TENANT, scopeDraftId: DRAFT, projectId: PROJECT, permission: "write" });
  collaborator.history.mockResolvedValue([]);
  collaborator.scopeDraft.mockImplementation(async () => state.scopeDraft);
  collaborator.effectiveItems.mockImplementation(async () => structuredClone(state.effectiveItems));
  collaborator.existing.mockImplementation(async () => structuredClone(state.existingEstimates));
});

describe("candidate-contract pipeline authorization", () => {
  it("P01: a denied preflight stops before the scope load, the idempotent lookup and any persistence", async () => {
    collaborator.preflight.mockRejectedValue(denial());
    const result = await outcome(run());
    expect.soft(result.error).toMatchObject({ code: "FORBIDDEN", message: "Override history is unavailable for this draft" });
    expect.soft(result.error).not.toBeInstanceOf(PipelineError);
    expect.soft(collaborator.preflight).toHaveBeenCalledWith(authority, DRAFT, "write");
    expect.soft(collaborator.scopeDraft).not.toHaveBeenCalled();
    expect.soft(collaborator.existing).not.toHaveBeenCalled();
    expect.soft(collaborator.history).not.toHaveBeenCalled();
    expect.soft(collaborator.persist).not.toHaveBeenCalled();
    expect(collaborator.audit).not.toHaveBeenCalled();
  });

  it("P02: an authorized run reaching an existing estimate is authorized before the idempotent return", async () => {
    state.existingEstimates = [{
      id: "est-existing", status: "draft", source: "scope_draft",
      draftData: { scopeDraftId: DRAFT, channel: "direct", grossProfitPct: 45, profitShieldPassed: true },
    }];
    const result = await run();
    expect(result.created).toBe(false);
    expect(result.draft.id).toBe("est-existing");
    expect(collaborator.preflight).toHaveBeenCalledTimes(1);
    expect(collaborator.preflight.mock.invocationCallOrder[0])
      .toBeLessThan(collaborator.existing.mock.invocationCallOrder[0]);
    expect(collaborator.persist).not.toHaveBeenCalled();
  });

  it("P03: the reader receives the same authority with write, and only matching assemblies are flagged", async () => {
    collaborator.history.mockResolvedValue([{
      id: "log-1", scopeDraftId: DRAFT, overrideId: "rule-1", originalAssemblyId: "asm-0",
      replacementAssemblyId: REPLACED_ASSEMBLY, overrideType: "swap", reason: "Coastal swap",
      createdAt: new Date("2026-09-15T00:00:00.000Z"),
    }]);
    const result = await run();
    expect(result.created).toBe(true);
    expect(collaborator.history).toHaveBeenCalledWith(authority, DRAFT, "write");
    const persisted = collaborator.persist.mock.calls[0][0] as {
      draftData: { assemblySelections: Array<Record<string, unknown>> };
    };
    expect(persisted.draftData.assemblySelections.map(selection => [selection.assemblyId, selection.overrideFlag]))
      .toEqual([[PLAIN_ASSEMBLY, false], [REPLACED_ASSEMBLY, true]]);
  });

  it("P04: a failing reader stops the run instead of persisting an estimate with an empty history", async () => {
    collaborator.history.mockRejectedValue(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Override history is unavailable" }));
    const result = await outcome(run());
    expect.soft(result.error).toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "Override history is unavailable" });
    expect.soft(result.error).not.toBeInstanceOf(PipelineError);
    expect(collaborator.persist).not.toHaveBeenCalled();
  });

  it("P04b: a commercial failure after a positive preflight is still a PipelineError, not an authorization error", async () => {
    state.effectiveItems = [];
    const result = await outcome(run());
    expect(result.error).toBeInstanceOf(PipelineError);
    expect(result.error).toMatchObject({ code: "NO_EFFECTIVE_ITEMS" });
    expect(collaborator.preflight).toHaveBeenCalledTimes(1);
  });
});
