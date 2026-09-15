/**
 * G2-1 bootstrap context proof.
 *
 * The real server/seed.ts main function is imported for its entrypoint behavior,
 * but every seed collaborator is replaced before import. This proves only that
 * the explicit SEED_TENANT_ID reaches each coastal override create call. It does
 * not execute a database seed or claim batch atomicity/idempotency.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COASTAL_OVERRIDE_SEED_RULES } from "../shared/geo-override-seed";

const collaborators = vi.hoisted(() => ({
  scope: vi.fn(),
  zones: vi.fn(),
  remodel: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
}));

vi.mock("./scope-db", () => ({ seedScopeRules: collaborators.scope }));
vi.mock("./geo-db", () => ({ seedCharlestonZones: collaborators.zones }));
vi.mock("./remodel-db", () => ({ seedRemodelTemplates: collaborators.remodel }));
vi.mock("./geo-override-db", () => ({
  listOverrideRules: collaborators.list,
  createOverrideRule: collaborators.create,
}));

const TENANT_A = "a2200000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("SEED_TENANT_ID", TENANT_A);
  collaborators.scope.mockResolvedValue(0);
  collaborators.zones.mockResolvedValue(0);
  collaborators.remodel.mockResolvedValue({ created: 0, updated: 0 });
  collaborators.list.mockResolvedValue([]);
  collaborators.create.mockImplementation(async (tenantId: string, data: Record<string, unknown>) => ({
    id: `c2200000-0000-4000-8000-${String(collaborators.create.mock.calls.length).padStart(12, "0")}`,
    tenantId,
    zoneId: null,
    assemblyId: null,
    costCodeId: null,
    overrideValue: null,
    reason: null,
    createdAt: new Date("2026-09-15T14:00:00.000Z"),
    updatedAt: new Date("2026-09-15T14:00:00.000Z"),
    ...data,
  }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
});

describe("G2-1 normal bootstrap context", () => {
  // Planned normal case 34.
  it("passes the explicit seed tenant to every coastal override create with all collaborators mocked", async () => {
    let resolveExit!: (code: number) => void;
    const exited = new Promise<number>(resolve => { resolveExit = resolve; });
    vi.spyOn(process, "exit").mockImplementation(code => {
      resolveExit(Number(code ?? 0));
      return undefined as never;
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await import("./seed");

    await expect(exited).resolves.toBe(0);
    expect(collaborators.zones).toHaveBeenCalledTimes(1);
    expect(collaborators.zones).toHaveBeenCalledWith(TENANT_A, "1");
    expect(collaborators.scope).toHaveBeenCalledTimes(1);
    expect(collaborators.remodel).toHaveBeenCalledTimes(1);
    expect(collaborators.list).toHaveBeenCalledTimes(1);
    // HISTORY: G2-1 checked creation context with the then-unscoped reader.
    // G2 rule-reader RED authorizes this adaptation: discovery also takes tenant A.
    expect(collaborators.list).toHaveBeenCalledWith(TENANT_A, { activeOnly: false });
    expect(collaborators.create).toHaveBeenCalledTimes(COASTAL_OVERRIDE_SEED_RULES.length);

    for (const [index, call] of collaborators.create.mock.calls.entries()) {
      expect(call[0]).toBe(TENANT_A);
      expect(call[1]).toEqual({
        zone: COASTAL_OVERRIDE_SEED_RULES[index].zone,
        trade: COASTAL_OVERRIDE_SEED_RULES[index].trade,
        finishLevel: COASTAL_OVERRIDE_SEED_RULES[index].finishLevel,
        originalAssemblyId: COASTAL_OVERRIDE_SEED_RULES[index].originalAssemblyId,
        replacementAssemblyId: COASTAL_OVERRIDE_SEED_RULES[index].replacementAssemblyId,
        overrideType: COASTAL_OVERRIDE_SEED_RULES[index].overrideType,
        reasonTemplate: COASTAL_OVERRIDE_SEED_RULES[index].reasonTemplate,
        isActive: COASTAL_OVERRIDE_SEED_RULES[index].active,
      });
      expect(call[2]).toBe("system_seed");
    }
  });
});
