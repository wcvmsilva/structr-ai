/**
 * PHASE 2 — Pre-visit persistence tests (mocked persistence)
 *
 * Covers server/previsit-db.ts, i.e. the layer that turns the pre-visit decision into
 * durable project state:
 *   - brief creation always bound to a project + tenant
 *   - checklist derivation and uniqueness
 *   - checklist capture / waive rules
 *   - completion blocked while required items are open
 *   - supersede behaviour and scope linkage
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, unknown>;

interface TableStore {
  projects: Row[];
  previsit_briefs: Row[];
  previsit_checklist_items: Row[];
  scope_drafts: Row[];
}

const store: TableStore = {
  projects: [],
  previsit_briefs: [],
  previsit_checklist_items: [],
  scope_drafts: [],
};

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
  const relevant = conditionValues.filter(
    (v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean",
  );
  if (relevant.length === 0) return true;
  const rowValues = new Set(Object.values(row));
  return relevant.some((v) => rowValues.has(v as never));
}

function makeSelectBuilder(rows: Row[]) {
  const builder: Record<string, unknown> = {};
  const result = () => rows.filter(matches);
  Object.assign(builder, {
    from: (table: unknown) => makeSelectBuilder(store[tableKey(table)]),
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
    select: () => {
      conditionValues = [];
      return makeSelectBuilder([]);
    },
    insert: (table: unknown) => {
      const key = tableKey(table);
      return {
        values: (payload: Row | Row[]) => {
          const rows = Array.isArray(payload) ? payload : [payload];
          const inserted = rows.map((r) => ({ ...r }));
          store[key].push(...inserted);
          return {
            returning: () => Promise.resolve(inserted),
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
            const promise = Promise.resolve(targets);
            return Object.assign(promise, {
              returning: () => Promise.resolve(targets),
            });
          },
        }),
      };
    },
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  };
  return db;
}

let dbAvailable = true;

vi.mock("./db", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getDb: vi.fn(async () => (dbAvailable ? (makeDb() as never) : null)),
  };
});

vi.mock("./audit", () => ({ logAudit: vi.fn(async () => undefined) }));

vi.mock("./lead-conversion", () => ({
  getProjectGeoContext: vi.fn(async () => ({
    zoneName: "Sullivan's Island",
    riskClass: "barrier_island" as const,
    warnings: [
      {
        code: "geo.barrier_island_exposure" as const,
        severity: "warning" as const,
        message: "Barrier island exposure detected.",
      },
    ],
    codes: ["geo.barrier_island_exposure" as const],
    reliable: true,
    zoneMinProfitShieldPct: 50,
  })),
}));

import {
  captureChecklistItem,
  completePrevisitBrief,
  createPrevisitBrief,
  getBriefWithChecklist,
  getLatestBriefForProject,
  linkBriefToScopeDraft,
  listBriefsForProject,
  PrevisitError,
} from "./previsit-db";
import type { EvidenceItem } from "@shared/previsit-engine";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const PROJECT = "33333333-3333-4333-8333-333333333333";

function factItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    key: "foundation_type",
    section: "structural_condition",
    label: "foundation type",
    value: "crawlspace",
    evidence: "FACT",
    source: "field inspection",
    ...overrides,
  };
}

function unknownItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    key: "septic_location",
    section: "property_context",
    label: "septic tank location",
    value: null,
    evidence: "UNKNOWN",
    ...overrides,
  };
}

beforeEach(() => {
  store.projects = [{ id: PROJECT, tenantId: TENANT, status: "intake", deletedAt: null }];
  store.previsit_briefs = [];
  store.previsit_checklist_items = [];
  store.scope_drafts = [];
  conditionValues = [];
  dbAvailable = true;
  vi.clearAllMocks();
});

describe("PHASE 2 pre-visit — creation", () => {
  it("P1: a brief is created bound to the project and its tenant", async () => {
    const result = await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      summary: "Crawlspace ranch, kitchen remodel intent.",
      items: [factItem()],
      nextStepCandidates: ["conceptual_estimate"],
      geoWarnings: [],
    });

    expect(result.brief.projectId).toBe(PROJECT);
    expect(result.brief.tenantId).toBe(TENANT);
    expect(result.brief.status).toBe("draft");
    expect(result.brief.emitsDefinitivePrice).toBe(false);
    expect(store.previsit_briefs).toHaveLength(1);
  });

  it("P2: the project advances to the previsit stage", async () => {
    await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem()],
      nextStepCandidates: ["conceptual_estimate"],
      geoWarnings: [],
    });

    expect(store.projects[0].status).toBe("previsit");
  });

  it("P3: an unknown project is refused", async () => {
    await expect(
      createPrevisitBrief({
        tenantId: TENANT,
        projectId: "44444444-4444-4444-8444-444444444444",
        userId: USER,
        items: [factItem()],
        nextStepCandidates: ["conceptual_estimate"],
        geoWarnings: [],
      }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("P4: a definitive price in the summary is rejected at persistence too (PVI-002)", async () => {
    await expect(
      createPrevisitBrief({
        tenantId: TENANT,
        projectId: PROJECT,
        userId: USER,
        summary: "The final price is $212,000.",
        items: [factItem()],
        nextStepCandidates: ["conceptual_estimate"],
        geoWarnings: [],
      }),
    ).rejects.toMatchObject({ code: "BRIEF_VALIDATION_FAILED" });

    expect(store.previsit_briefs).toHaveLength(0);
  });

  it("P5: evidence statistics are persisted for reporting", async () => {
    const result = await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [
        factItem(),
        unknownItem(),
        factItem({ key: "beam_span", evidence: "INFERENCE", value: "16 ft", rationale: "era typical" }),
      ],
      nextStepCandidates: ["conceptual_estimate"],
      geoWarnings: [],
    });

    expect(result.brief.unknownCount).toBe(1);
    expect(result.brief.inferenceCount).toBe(1);
    expect(result.brief.factCoveragePct).toBe("33.3");
  });

  it("P6: UNKNOWN items materialize as required checklist rows", async () => {
    const result = await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem(), unknownItem()],
      nextStepCandidates: ["conceptual_estimate"],
      geoWarnings: [],
    });

    expect(result.checklist).toHaveLength(1);
    expect(result.checklist[0].itemKey).toBe("verify_septic_location");
    expect(result.checklist[0].isRequired).toBe(true);
    expect(result.checklist[0].status).toBe("open");
    expect(result.checklist[0].projectId).toBe(PROJECT);
  });

  it("P7: geo warnings are read from the project when not supplied", async () => {
    const result = await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem()],
      nextStepCandidates: ["conceptual_estimate"],
    });

    const keys = result.checklist.map((c) => c.itemKey);
    expect(keys).toContain("coastal_wind_exposure_confirmed");
    expect(keys).toContain("coastal_flood_zone_confirmed");
    expect(keys).toContain("coastal_corrosion_check");
  });

  it("P8: a single recommendation is stored with the discarded options", async () => {
    const result = await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem()],
      nextStepCandidates: ["conceptual_estimate", "structural_evaluation"],
      geoWarnings: [],
    });

    expect(result.brief.nextStep).toBe("structural_evaluation");
    expect(result.brief.discardedNextSteps).toEqual(["conceptual_estimate"]);
    expect(result.allowsEstimate).toBe(false);
  });

  it("P9: a conceptual estimate recommendation marks the brief estimate-ready", async () => {
    const result = await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem()],
      nextStepCandidates: ["conceptual_estimate"],
      geoWarnings: [],
    });

    expect(result.allowsEstimate).toBe(true);
  });

  it("P10: a new brief supersedes the previous draft instead of deleting it", async () => {
    await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem()],
      nextStepCandidates: ["conceptual_estimate"],
      geoWarnings: [],
    });
    await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem({ value: "slab" })],
      nextStepCandidates: ["design"],
      geoWarnings: [],
    });

    expect(store.previsit_briefs).toHaveLength(2);
    expect(store.previsit_briefs.filter((b) => b.status === "superseded")).toHaveLength(1);
  });

  it("P11: an unavailable database fails closed", async () => {
    dbAvailable = false;
    await expect(
      createPrevisitBrief({
        tenantId: TENANT,
        projectId: PROJECT,
        userId: USER,
        items: [factItem()],
        nextStepCandidates: ["conceptual_estimate"],
        geoWarnings: [],
      }),
    ).rejects.toBeInstanceOf(PrevisitError);
  });
});

describe("PHASE 2 pre-visit — checklist and completion", () => {
  async function seedBriefWithOpenItem() {
    return createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem(), unknownItem()],
      nextStepCandidates: ["conceptual_estimate"],
      geoWarnings: [],
    });
  }

  it("P12: capturing a value resolves the item and records the evidence class", async () => {
    const created = await seedBriefWithOpenItem();
    const itemId = created.checklist[0].id;

    const updated = await captureChecklistItem({
      itemId,
      userId: USER,
      value: "rear yard, 18 ft from foundation",
    });

    expect(updated.status).toBe("captured");
    expect(updated.capturedEvidence).toBe("FACT");
    expect(updated.capturedBy).toBe(USER);
  });

  it("P13: capturing without a value is refused", async () => {
    const created = await seedBriefWithOpenItem();

    await expect(
      captureChecklistItem({ itemId: created.checklist[0].id, userId: USER, value: "  " }),
    ).rejects.toMatchObject({ code: "BRIEF_VALIDATION_FAILED" });
  });

  it("P14: waiving requires a reason and is recorded as accepted risk", async () => {
    const created = await seedBriefWithOpenItem();

    const updated = await captureChecklistItem({
      itemId: created.checklist[0].id,
      userId: USER,
      waiveReason: "Septic located by county records; field confirmation deferred to survey.",
    });

    expect(updated.status).toBe("waived");
    expect(updated.waivedReason).toBeTruthy();
  });

  it("P15: an unknown checklist item is a not-found error", async () => {
    await expect(
      captureChecklistItem({ itemId: "no-such-item", userId: USER, value: "x" }),
    ).rejects.toMatchObject({ code: "CHECKLIST_ITEM_NOT_FOUND" });
  });

  it("P16: completion is blocked while a required item is open", async () => {
    const created = await seedBriefWithOpenItem();

    await expect(completePrevisitBrief(created.brief.id, USER)).rejects.toMatchObject({
      code: "BRIEF_NOT_READY",
    });
    expect(store.previsit_briefs[0].status).toBe("draft");
  });

  it("P17: completion succeeds once every required item is resolved", async () => {
    const created = await seedBriefWithOpenItem();
    await captureChecklistItem({
      itemId: created.checklist[0].id,
      userId: USER,
      value: "rear yard",
    });

    const completed = await completePrevisitBrief(created.brief.id, USER);
    expect(completed.brief.status).toBe("completed");
    expect(completed.brief.completedBy).toBe(USER);
  });

  it("P18: a waived required item also unblocks completion", async () => {
    const created = await seedBriefWithOpenItem();
    await captureChecklistItem({
      itemId: created.checklist[0].id,
      userId: USER,
      waiveReason: "Deferred to survey scope.",
    });

    const completed = await completePrevisitBrief(created.brief.id, USER);
    expect(completed.brief.status).toBe("completed");
  });

  it("P19: completing an already completed brief is idempotent", async () => {
    const created = await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem()],
      nextStepCandidates: ["conceptual_estimate"],
      geoWarnings: [],
    });

    await completePrevisitBrief(created.brief.id, USER);
    const again = await completePrevisitBrief(created.brief.id, USER);
    expect(again.brief.status).toBe("completed");
  });

  it("P20: a superseded brief can no longer be completed", async () => {
    const first = await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem()],
      nextStepCandidates: ["conceptual_estimate"],
      geoWarnings: [],
    });
    await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem({ value: "slab" })],
      nextStepCandidates: ["design"],
      geoWarnings: [],
    });

    await expect(completePrevisitBrief(first.brief.id, USER)).rejects.toMatchObject({
      code: "BRIEF_LOCKED",
    });
  });

  it("P21: an unknown brief is a not-found error", async () => {
    await expect(completePrevisitBrief("no-such-brief", USER)).rejects.toMatchObject({
      code: "BRIEF_NOT_FOUND",
    });
  });
});

describe("PHASE 2 pre-visit — reads and scope linkage", () => {
  it("P22: reads return the brief with checklist and readiness", async () => {
    const created = await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem(), unknownItem()],
      nextStepCandidates: ["conceptual_estimate"],
      geoWarnings: [],
    });

    const loaded = await getBriefWithChecklist(created.brief.id);
    expect(loaded?.checklist).toHaveLength(1);
    expect(loaded?.readiness.canComplete).toBe(false);
    expect(loaded?.readiness.requiredChecklistOpen).toBe(1);
  });

  it("P23: the latest brief for a project is retrievable", async () => {
    await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem()],
      nextStepCandidates: ["conceptual_estimate"],
      geoWarnings: [],
    });

    const latest = await getLatestBriefForProject(PROJECT);
    expect(latest?.brief.projectId).toBe(PROJECT);

    const all = await listBriefsForProject(PROJECT);
    expect(all).toHaveLength(1);
  });

  it("P24: linking a brief propagates the geo risk class to the scope draft", async () => {
    const created = await createPrevisitBrief({
      tenantId: TENANT,
      projectId: PROJECT,
      userId: USER,
      items: [factItem()],
      nextStepCandidates: ["conceptual_estimate"],
      geoWarnings: [],
    });
    store.scope_drafts.push({ id: "scope-1", projectId: PROJECT, status: "draft" });

    const linked = await linkBriefToScopeDraft(created.brief.id, "scope-1", USER);

    expect(linked).toBe(true);
    expect(store.scope_drafts[0].previsitBriefId).toBe(created.brief.id);
    expect(store.scope_drafts[0].geoRiskClass).toBe("barrier_island");
  });

  it("P25: linking an unknown brief or scope draft returns false instead of throwing", async () => {
    expect(await linkBriefToScopeDraft("nope", "scope-1", USER)).toBe(false);
  });
});
