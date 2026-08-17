/**
 * PHASE 2 — Scope → Estimate pipeline gates
 *
 * The pipeline is the single door between an approved scope and a priced estimate.
 * These tests exercise its Phase 2 additions against mocked dependencies:
 *
 *   - an estimate cannot be produced from a scope that is not approved
 *   - a pre-visit whose recommendation is verification work blocks pricing
 *   - the Profit Shield is evaluated per commercial channel and can block creation
 *   - the resulting draft preserves the full pricing snapshot (channel, finish, region,
 *     zone, risk class, geo warning codes, pre-visit brief)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── State controlling the mocked dependencies ─────────────────────────

const state: {
  scopeDraft: Record<string, unknown> | null;
  effectiveItems: Array<Record<string, unknown>>;
  project: Record<string, unknown> | null;
  previsit: { brief: Record<string, unknown> } | null;
  geoContext: Record<string, unknown> | null;
  existingEstimates: Array<Record<string, unknown>>;
  createdDrafts: Array<Record<string, unknown>>;
  assemblyGrossProfitPct: number;
  assemblyTotalCost: number;
  assemblyTotalPrice: number;
} = {
  scopeDraft: null,
  effectiveItems: [],
  project: null,
  previsit: null,
  geoContext: null,
  existingEstimates: [],
  createdDrafts: [],
  assemblyGrossProfitPct: 45,
  assemblyTotalCost: 550,
  assemblyTotalPrice: 1000,
};

vi.mock("./db", () => ({
  getDb: vi.fn(async () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(state.existingEstimates),
      }),
    }),
  })),
  createEstimateDraft: vi.fn(async (payload: Record<string, unknown>) => {
    const draft = {
      id: `est-${state.createdDrafts.length + 1}`,
      status: "draft",
      ...payload,
    };
    state.createdDrafts.push(draft);
    return draft;
  }),
}));

vi.mock("./audit", () => ({ logAudit: vi.fn(async () => undefined) }));

vi.mock("./scope-db", () => ({
  getScopeDraftById: vi.fn(async () => state.scopeDraft),
}));

vi.mock("./scope-review-db", () => ({
  getEffectiveItems: vi.fn(async () => state.effectiveItems),
}));

vi.mock("./project-db", () => ({
  getProjectById: vi.fn(async () => state.project),
}));

vi.mock("./assembly-db", () => ({
  getAssemblyById: vi.fn(async (id: string) => ({
    id,
    name: `Assembly ${id}`,
    category: "Interior Finishes",
    isActive: true,
    components: [
      {
        id: "c1",
        componentType: "material",
        description: "Oak flooring",
        quantity: 100,
        unit: "SF",
        wasteFactor: 0.1,
        unitCostOverride: null,
        priceBookItem: {
          id: "pb1",
          name: "Oak flooring",
          unitCost: "4.50",
          unitPrice: "10.00",
          wasteFactor: "0.10",
          coastalModifier: null,
          itemType: "material",
        },
      },
    ],
  })),
}));

vi.mock("./pricing-dimensions", () => ({
  resolvePricingDimensions: vi.fn(async () => ({
    channelCostMultiplier: 1,
    channelPriceMultiplier: 1,
    finishPriceMultiplier: 1,
    regionalCostModifier: 1,
    regionalLaborModifier: 1,
    regionalMaterialModifier: 1,
    regionalPermitModifier: 1,
    sources: { channel: "db", finish: "db", regional: "db" },
  })),
  toPricingEngineDimensions: vi.fn(() => ({})),
}));

vi.mock("./geo-override-db", () => ({
  getOverrideLogForDraft: vi.fn(async () => []),
}));

vi.mock("./lead-conversion", () => ({
  getProjectGeoContext: vi.fn(async () => state.geoContext),
}));

vi.mock("./previsit-db", () => ({
  getLatestBriefForProject: vi.fn(async () => state.previsit),
}));

vi.mock("@shared/assembly-engine", () => ({
  calculateMultipleAssemblies: vi.fn(() => ({
    assemblies: [
      {
        assemblyId: "asm-1",
        assemblyName: "Assembly asm-1",
        grossProfitPct: state.assemblyGrossProfitPct,
        totalCost: state.assemblyTotalCost,
        totalPrice: state.assemblyTotalPrice,
        components: [],
      },
    ],
    totalCost: state.assemblyTotalCost,
    totalPrice: state.assemblyTotalPrice,
    grossProfitPct: state.assemblyGrossProfitPct,
    meetsMinGP: state.assemblyGrossProfitPct >= 35,
  })),
}));

vi.mock("@shared/estimate-engine", () => ({
  validateEstimateDraftInputs: vi.fn(() => []),
  transformBatchToEstimateDraft: vi.fn(() => ({
    metadata: {},
    assemblySelections: [{ assemblyId: "asm-1" }],
    lineItems: [],
  })),
}));

import {
  executeScopeToEstimatePipeline,
  PipelineError,
} from "./scope-to-estimate-pipeline";

const PROJECT = "33333333-3333-4333-8333-333333333333";
const USER = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  state.scopeDraft = { id: "scope-1", status: "approved", projectId: PROJECT };
  state.effectiveItems = [{ assemblyId: "asm-1", quantity: 1, reason: null }];
  state.project = {
    id: PROJECT,
    name: "Whitfield Remodel",
    channel: "direct",
    commercialChannel: "premium",
    zone: "West Ashley",
  };
  state.previsit = {
    brief: { id: "brief-1", nextStep: "conceptual_estimate", status: "completed" },
  };
  state.geoContext = {
    zoneName: "West Ashley",
    riskClass: "inland",
    warnings: [],
    codes: [],
    reliable: true,
    zoneMinProfitShieldPct: null,
  };
  state.existingEstimates = [];
  state.createdDrafts = [];
  state.assemblyGrossProfitPct = 45;
  state.assemblyTotalCost = 550;
  state.assemblyTotalPrice = 1000;
  vi.clearAllMocks();
});

describe("PHASE 2 pipeline — scope approval gate", () => {
  it("S1: an approved scope produces an estimate draft", async () => {
    const result = await executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER);

    expect(result.created).toBe(true);
    expect(result.draft.id).toBe("est-1");
    expect(result.batchSummary.grossProfitPct).toBe(45);
  });

  it("S2: a draft scope cannot produce an estimate", async () => {
    state.scopeDraft = { id: "scope-1", status: "draft", projectId: PROJECT };

    await expect(
      executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER),
    ).rejects.toMatchObject({ code: "SCOPE_DRAFT_INVALID_STATUS" });
  });

  it("S3: a scope under review cannot produce an estimate", async () => {
    state.scopeDraft = { id: "scope-1", status: "under_review", projectId: PROJECT };

    await expect(
      executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER),
    ).rejects.toMatchObject({ code: "SCOPE_DRAFT_INVALID_STATUS" });
  });

  it("S4: a rejected scope cannot produce an estimate", async () => {
    state.scopeDraft = { id: "scope-1", status: "rejected", projectId: PROJECT };

    await expect(
      executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER),
    ).rejects.toBeInstanceOf(PipelineError);
  });

  it("S5: a converted scope is still valid (it already passed review)", async () => {
    state.scopeDraft = { id: "scope-1", status: "converted", projectId: PROJECT };

    const result = await executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER);
    expect(result.created).toBe(true);
  });

  it("S6: an unknown scope draft is a not-found error", async () => {
    state.scopeDraft = null;

    await expect(
      executeScopeToEstimatePipeline({ scopeDraftId: "scope-x" }, USER),
    ).rejects.toMatchObject({ code: "SCOPE_DRAFT_NOT_FOUND" });
  });

  it("S7: a scope with no effective items is refused", async () => {
    state.effectiveItems = [];

    await expect(
      executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER),
    ).rejects.toMatchObject({ code: "NO_EFFECTIVE_ITEMS" });
  });
});

describe("PHASE 2 pipeline — pre-visit gate", () => {
  it("S8: a recommendation of structural evaluation blocks pricing", async () => {
    state.previsit = {
      brief: { id: "brief-1", nextStep: "structural_evaluation", status: "completed" },
    };

    await expect(
      executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER),
    ).rejects.toMatchObject({ code: "PREVISIT_BLOCKS_ESTIMATE" });
  });

  it("S9: a recommendation of survey / zoning verification blocks pricing", async () => {
    state.previsit = {
      brief: { id: "brief-1", nextStep: "survey_zoning_verification", status: "completed" },
    };

    await expect(
      executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER),
    ).rejects.toMatchObject({ code: "PREVISIT_BLOCKS_ESTIMATE" });
  });

  it("S10: paid preconstruction authorizes pricing", async () => {
    state.previsit = {
      brief: { id: "brief-1", nextStep: "paid_preconstruction", status: "completed" },
    };

    const result = await executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER);
    expect(result.created).toBe(true);
    expect(result.contextSnapshot.previsitBriefId).toBe("brief-1");
  });

  it("S11: an unfinished pre-visit warns but does not block", async () => {
    state.previsit = {
      brief: { id: "brief-1", nextStep: "conceptual_estimate", status: "draft" },
    };

    const result = await executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER);
    expect(result.created).toBe(true);
    expect(result.warnings.some((w) => w.field === "previsit")).toBe(true);
  });

  it("S12: a legacy project without a pre-visit is warned, not blocked", async () => {
    state.previsit = null;

    const result = await executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER);
    expect(result.created).toBe(true);
    expect(result.warnings.find((w) => w.field === "previsit")?.message).toMatch(
      /No pre-visit brief/i,
    );
  });
});

describe("PHASE 2 pipeline — Profit Shield", () => {
  it("S13: the shield is evaluated against the project's commercial channel", async () => {
    const result = await executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER);

    expect(result.profitShield?.channel).toBe("premium");
    expect(result.profitShield?.effectiveFloorPct).toBe(28);
    expect(result.profitShield?.blocked).toBe(false);
  });

  it("S14: a Premium margin below 28% is reported as a violation", async () => {
    state.assemblyGrossProfitPct = 22;

    const result = await executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER);

    expect(result.profitShield?.blocked).toBe(true);
    expect(result.warnings.some((w) => w.field === "profitShieldChannel")).toBe(true);
  });

  it("S15: with blockOnProfitShield the same margin refuses creation", async () => {
    state.assemblyGrossProfitPct = 22;

    await expect(
      executeScopeToEstimatePipeline(
        { scopeDraftId: "scope-1", blockOnProfitShield: true },
        USER,
      ),
    ).rejects.toMatchObject({ code: "PROFIT_SHIELD_VIOLATION" });

    expect(state.createdDrafts).toHaveLength(0);
  });

  it("S16: the Trade channel accepts a margin the Premium channel rejects", async () => {
    state.assemblyGrossProfitPct = 22;
    state.project = { ...state.project, commercialChannel: "trade" };

    const result = await executeScopeToEstimatePipeline(
      { scopeDraftId: "scope-1", blockOnProfitShield: true },
      USER,
    );

    expect(result.profitShield?.channel).toBe("trade");
    expect(result.profitShield?.effectiveFloorPct).toBe(18);
    expect(result.profitShield?.blocked).toBe(false);
  });

  it("S17: a coastal project raises the floor to 42% even on Trade", async () => {
    state.assemblyGrossProfitPct = 30;
    state.project = { ...state.project, commercialChannel: "trade", zone: "Folly Beach" };
    state.geoContext = {
      zoneName: "Folly Beach",
      riskClass: "coastal",
      warnings: [],
      codes: ["geo.coastal_exposure"],
      reliable: true,
      zoneMinProfitShieldPct: 42,
    };

    const result = await executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER);

    expect(result.profitShield?.effectiveFloorPct).toBe(42);
    expect(result.profitShield?.blocked).toBe(true);
  });

  it("S18: an explicit commercial channel override wins over the project", async () => {
    state.assemblyGrossProfitPct = 16;

    const result = await executeScopeToEstimatePipeline(
      { scopeDraftId: "scope-1", commercialChannelOverride: "capital" },
      USER,
    );

    expect(result.profitShield?.channel).toBe("capital");
    expect(result.profitShield?.effectiveFloorPct).toBe(15);
    expect(result.profitShield?.blocked).toBe(false);
  });
});

describe("PHASE 2 pipeline — pricing snapshot", () => {
  it("S19: the context snapshot preserves every pricing dimension", async () => {
    state.geoContext = {
      zoneName: "Isle of Palms",
      riskClass: "barrier_island",
      warnings: [],
      codes: ["geo.barrier_island_exposure", "geo.high_cost_multiplier"],
      reliable: true,
      zoneMinProfitShieldPct: 50,
    };
    state.assemblyGrossProfitPct = 55;
    state.project = { ...state.project, zone: "Isle of Palms" };

    const result = await executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER);
    const snapshot = result.contextSnapshot;

    expect(snapshot.channel).toBe("direct");
    expect(snapshot.commercialChannel).toBe("premium");
    expect(snapshot.finishLevel).toBe("standard");
    expect(snapshot.region).toBe("charleston");
    expect(snapshot.zone).toBe("Isle of Palms");
    expect(snapshot.geoRiskClass).toBe("barrier_island");
    expect(snapshot.geoWarningCodes).toEqual([
      "geo.barrier_island_exposure",
      "geo.high_cost_multiplier",
    ]);
    expect(snapshot.previsitBriefId).toBe("brief-1");
    expect(snapshot.pricingSchemaVersion).toBe("1.0");
  });

  it("S20: geo warning codes are propagated as caller-visible warnings", async () => {
    state.geoContext = {
      zoneName: "Folly Beach",
      riskClass: "coastal",
      warnings: [],
      codes: ["geo.coastal_exposure"],
      reliable: true,
      zoneMinProfitShieldPct: 42,
    };
    state.assemblyGrossProfitPct = 55;

    const result = await executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER);
    expect(result.warnings.some((w) => w.field === "geo" && w.message === "geo.coastal_exposure")).toBe(
      true,
    );
  });

  it("S21: the persisted draftData carries the shield evaluation and the floor", async () => {
    await executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER);

    const draftData = state.createdDrafts[0].draftData as Record<string, unknown>;
    expect(draftData.commercialChannel).toBe("premium");
    expect(draftData.profitShieldFloorPct).toBe(28);
    expect(draftData.profitShieldBlocked).toBe(false);
    expect(draftData.geoRiskClass).toBe("inland");
    expect(draftData.previsitBriefId).toBe("brief-1");
    expect(draftData.profitShieldEvaluation).toBeTruthy();
  });

  it("S22: the pipeline is idempotent for the same scope draft", async () => {
    state.existingEstimates = [
      {
        id: "est-existing",
        status: "draft",
        source: "scope_draft",
        draftData: {
          scopeDraftId: "scope-1",
          channel: "direct",
          grossProfitPct: 45,
          profitShieldPassed: true,
        },
      },
    ];

    const result = await executeScopeToEstimatePipeline({ scopeDraftId: "scope-1" }, USER);

    expect(result.created).toBe(false);
    expect(result.draft.id).toBe("est-existing");
    expect(state.createdDrafts).toHaveLength(0);
  });
});
