import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), create: vi.fn(), clear: vi.fn(), update: vi.fn(), add: vi.fn(), intake: vi.fn(), project: vi.fn(), assemblies: vi.fn(), draft: vi.fn() }));
vi.mock("./db", () => ({ getDb: mocks.db }));
vi.mock("./scope-db", async original => ({ ...await original<typeof import("./scope-db")>(), createScopeDraft: mocks.create, clearScopeDraftItems: mocks.clear, updateScopeDraftStatus: mocks.update, addScopeDraftItems: mocks.add, getScopeDraftById: mocks.draft }));
vi.mock("./intake-db", () => ({ getIntakeFormById: mocks.intake }));
vi.mock("./project-db", () => ({ getProjectById: mocks.project }));
vi.mock("./assembly-db", () => ({ listAssemblies: mocks.assemblies }));
vi.mock("./project-access", () => ({ requireProjectAccessTrpc: vi.fn(), requireEntityAccess: vi.fn(), getScopeDraftIdForItem: vi.fn() }));
import { loadActiveRulesForEngine } from "./scope-db";
import { scopeRouter } from "./scope-router";

const ID = "b9100000-0000-4000-8000-000000000001";
let quantityFormula: unknown;
const caller = () => scopeRouter.createCaller({ user: { id: ID, role: "admin" }, tenantId: ID } as any);
beforeEach(() => {
  vi.resetAllMocks(); quantityFormula = 1;
  const rows = () => [{ id: ID, ruleCode: "FIXTURE", assemblyId: ID, serviceType: "kitchen_remodel", projectType: null, finishLevel: null, channel: null, zone: null, conditionJson: null, quantityFormula, reasonTemplate: "Synthetic", priority: 1, isActive: true }];
  const query: any = { orderBy: () => query, where: () => query, then: (resolve: any, reject: any) => Promise.resolve(rows()).then(resolve, reject) };
  mocks.db.mockResolvedValue({ select: () => ({ from: () => query }) });
  mocks.intake.mockResolvedValue({ id: ID, projectId: ID, tenantId: ID, formData: { serviceType: "kitchen_remodel", area: "200", finishLevel: "standard" } });
  mocks.project.mockResolvedValue({ id: ID, tenantId: ID, projectType: "remodel" });
  mocks.assemblies.mockResolvedValue({ items: [{ id: ID, tenantId: ID, name: "Synthetic assembly", category: "Synthetic" }] });
  mocks.create.mockResolvedValue({ id: ID });
  mocks.draft.mockResolvedValue({ id: ID, projectId: ID, intakeFormId: ID });
});

describe("JSONB scope formula boundary", () => {
  it.each([[1, "1"], [2.5, "2.5"], [0, "0"], [null, "1"], [undefined, "1"], ["ceil(area / 32)", "ceil(area / 32)"], [" 2 ", " 2 "]])("normalizes %s for all rule consumers", async (input, expected) => {
    quantityFormula = input;
    expect((await loadActiveRulesForEngine())[0].quantityFormula).toBe(expected);
  });
  it.each([{}, [], true, false, NaN, Infinity, -Infinity])("rejects unsupported stored formula %s", async input => {
    quantityFormula = input;
    await expect(loadActiveRulesForEngine()).rejects.toThrow("Invalid stored scope quantity formula");
  });
  it.each(["generate", "preview", "regenerate"] as const)("%s evaluates a numeric JSONB formula through the real engine", async method => {
    quantityFormula = 2.5;
    const api = caller();
    const result = method === "generate" ? await api.generate({ intakeFormId: ID, projectId: ID }) : method === "preview" ? await api.preview({ serviceType: "kitchen_remodel", area: "200" }) : await api.regenerate({ draftId: ID });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].quantity).toBe(2.5);
  });
  it.each(["generate", "preview", "regenerate"] as const)("%s rejects objects before writing or clearing prior items", async method => {
    quantityFormula = { formula: "1" };
    const api = caller();
    const result = method === "generate" ? api.generate({ intakeFormId: ID, projectId: ID }) : method === "preview" ? api.preview({ serviceType: "kitchen_remodel" }) : api.regenerate({ draftId: ID });
    await expect(result).rejects.toThrow("Invalid stored scope quantity formula");
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.clear).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.add).not.toHaveBeenCalled();
  });
});
