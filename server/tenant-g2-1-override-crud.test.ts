/**
 * G2-1 normal caller proofs for geographic override CRUD.
 *
 * The tRPC router, its authentication/tenant/admin middleware, Zod inputs,
 * normalization, and update mapper are real. The business helpers are replaced
 * deliberately: this file proves only caller boundary, trusted-context
 * propagation, and public-to-DB payload mapping. SQL ownership and transaction
 * behavior belong to tenant-g2-1-override-crud-postgres.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const boundary = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deactivate: vi.fn(),
  reactivate: vi.fn(),
  getLog: vi.fn(),
  writeLog: vi.fn(),
  hasOverrides: vi.fn(),
  clearLog: vi.fn(),
  counts: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("./geo-override-db", () => ({
  listOverrideRules: boundary.list,
  getOverrideRuleById: boundary.get,
  createOverrideRule: boundary.create,
  updateOverrideRule: boundary.update,
  deactivateOverrideRule: boundary.deactivate,
  reactivateOverrideRule: boundary.reactivate,
  getOverrideLogForDraft: boundary.getLog,
  writeOverrideLogEntries: boundary.writeLog,
  hasOverridesApplied: boundary.hasOverrides,
  clearOverrideLogForDraft: boundary.clearLog,
  getOverrideCountsByZone: boundary.counts,
}));

vi.mock("./audit", () => ({
  logAudit: boundary.audit,
  withAuditLog: vi.fn(async (_metadata: unknown, work: () => unknown) => work()),
}));

import { router, TENANT_UNRESOLVED_ERR_MSG } from "./_core/trpc";
import { geoOverrideRouter } from "./geo-override-router";
import { COASTAL_OVERRIDE_SEED_RULES } from "../shared/geo-override-seed";

const TENANT_A = "a2100000-0000-4000-8000-000000000001";
const TENANT_B = "a2100000-0000-4000-8000-000000000002";
const ACTOR = "b2100000-0000-4000-8000-000000000001";
const RULE = "c2100000-0000-4000-8000-000000000001";
const ORIGINAL_ASSEMBLY = "d2100000-0000-4000-8000-000000000001";
const REPLACEMENT_ASSEMBLY = "d2100000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-15T14:00:00.000Z");

const ruleRow = {
  id: RULE,
  tenantId: TENANT_A,
  zoneId: null,
  assemblyId: null,
  costCodeId: null,
  overrideType: "swap",
  overrideValue: null,
  reason: null,
  zone: "Charleston Coastal",
  trade: "electrical",
  finishLevel: "premium",
  reasonTemplate: "Use the coastal assembly",
  originalAssemblyId: ORIGINAL_ASSEMBLY,
  replacementAssemblyId: REPLACEMENT_ASSEMBLY,
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const createInput = {
  zone: "Charleston Coastal",
  trade: "electrical",
  finishLevel: "premium",
  originalAssemblyId: ORIGINAL_ASSEMBLY,
  replacementAssemblyId: REPLACEMENT_ASSEMBLY,
  overrideType: "swap" as const,
  reasonTemplate: "Use the coastal assembly",
  active: true,
};

const api = router({ geoOverride: geoOverrideRouter });

function context(
  role: "admin" | "user" | null,
  tenantId: string | null = TENANT_A,
): TrpcContext {
  return {
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: role === null ? null : { id: ACTOR, role, tenantId } as NonNullable<TrpcContext["user"]>,
    tenantId,
    authProvider: "legacy",
  };
}

type Caller = ReturnType<typeof api.createCaller>;
type Invocation = (caller: Caller) => Promise<unknown>;

const allRouteInvocations: ReadonlyArray<readonly [string, Invocation, "admin" | "user"]> = [
  ["getRule", caller => caller.geoOverride.getRule({ id: RULE }), "user"],
  ["createRule", caller => caller.geoOverride.createRule(createInput), "admin"],
  ["updateRule", caller => caller.geoOverride.updateRule({ id: RULE, zone: "Barrier Island Premium" }), "admin"],
  ["deactivateRule", caller => caller.geoOverride.deactivateRule({ id: RULE }), "admin"],
  ["reactivateRule", caller => caller.geoOverride.reactivateRule({ id: RULE }), "admin"],
  ["seedCoastalRules", caller => caller.geoOverride.seedCoastalRules(), "admin"],
];

const adminRouteInvocations = allRouteInvocations.filter(([, , role]) => role === "admin");

function expectNoBusinessDelegation() {
  expect(boundary.list).not.toHaveBeenCalled();
  expect(boundary.get).not.toHaveBeenCalled();
  expect(boundary.create).not.toHaveBeenCalled();
  expect(boundary.update).not.toHaveBeenCalled();
  expect(boundary.deactivate).not.toHaveBeenCalled();
  expect(boundary.reactivate).not.toHaveBeenCalled();
  expect(boundary.audit).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  boundary.list.mockResolvedValue([]);
  boundary.get.mockResolvedValue(ruleRow);
  boundary.create.mockResolvedValue(ruleRow);
  boundary.update.mockResolvedValue(ruleRow);
  boundary.deactivate.mockResolvedValue(true);
  boundary.reactivate.mockResolvedValue(true);
  boundary.getLog.mockResolvedValue([]);
  boundary.writeLog.mockResolvedValue(0);
  boundary.hasOverrides.mockResolvedValue(false);
  boundary.clearLog.mockResolvedValue(0);
  boundary.counts.mockResolvedValue([]);
  boundary.audit.mockResolvedValue(undefined);
});

describe("G2-1 normal boundary · authentication", () => {
  // Planned normal cases 1-6: every touched route rejects before its helper.
  it.each(allRouteInvocations)(
    "%s rejects a caller without a user before business delegation",
    async (_name, invoke) => {
      await expect(invoke(api.createCaller(context(null)))).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
      expectNoBusinessDelegation();
    },
  );
});

describe("G2-1 normal boundary · resolved tenant", () => {
  // Planned normal cases 7-12: role does not substitute for tenant context.
  it.each(allRouteInvocations)(
    "%s rejects an unresolved tenant before business delegation",
    async (_name, invoke, role) => {
      await expect(invoke(api.createCaller(context(role, null)))).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: TENANT_UNRESOLVED_ERR_MSG,
      });
      expectNoBusinessDelegation();
    },
  );
});

describe("G2-1 normal boundary · admin role", () => {
  // Planned normal cases 13-17: all five writes preserve the existing admin gate.
  it.each(adminRouteInvocations)(
    "%s rejects a resolved ordinary user before business delegation",
    async (_name, invoke) => {
      await expect(invoke(api.createCaller(context("user")))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expectNoBusinessDelegation();
    },
  );
});

describe("G2-1 normal caller context propagation", () => {
  // Planned normal case 18.
  it("getRule forwards tenant A with the requested rule ID", async () => {
    await expect(api.createCaller(context("user")).geoOverride.getRule({ id: RULE }))
      .resolves.toEqual(ruleRow);
    expect(boundary.get).toHaveBeenCalledTimes(1);
    expect(boundary.get).toHaveBeenCalledWith(TENANT_A, RULE);
  });

  // Planned normal case 19.
  it("createRule forwards tenant A, the normalized payload, and the authenticated actor", async () => {
    await expect(api.createCaller(context("admin")).geoOverride.createRule(createInput))
      .resolves.toEqual(ruleRow);
    expect(boundary.create).toHaveBeenCalledTimes(1);
    expect(boundary.create).toHaveBeenCalledWith(
      TENANT_A,
      {
        zone: "Charleston Coastal",
        trade: "electrical",
        finishLevel: "premium",
        originalAssemblyId: ORIGINAL_ASSEMBLY,
        replacementAssemblyId: REPLACEMENT_ASSEMBLY,
        overrideType: "swap",
        reasonTemplate: "Use the coastal assembly",
        isActive: true,
      },
      ACTOR,
    );
  });

  // Planned normal case 20.
  it("updateRule forwards tenant A, the rule ID, the patch, and the authenticated actor", async () => {
    await expect(api.createCaller(context("admin")).geoOverride.updateRule({
      id: RULE,
      zone: "Barrier Island Premium",
    })).resolves.toEqual(ruleRow);
    expect(boundary.update).toHaveBeenCalledTimes(1);
    expect(boundary.update).toHaveBeenCalledWith(
      TENANT_A,
      RULE,
      { zone: "Barrier Island Premium" },
      ACTOR,
    );
    expect(boundary.get).not.toHaveBeenCalled();
  });

  // Planned normal case 21.
  it("deactivateRule forwards tenant A, the rule ID, and the authenticated actor", async () => {
    await expect(api.createCaller(context("admin")).geoOverride.deactivateRule({ id: RULE }))
      .resolves.toBe(true);
    expect(boundary.deactivate).toHaveBeenCalledTimes(1);
    expect(boundary.deactivate).toHaveBeenCalledWith(TENANT_A, RULE, ACTOR);
    expect(boundary.get).not.toHaveBeenCalled();
  });

  // Planned normal case 22.
  it("reactivateRule forwards tenant A, the rule ID, and the authenticated actor", async () => {
    await expect(api.createCaller(context("admin")).geoOverride.reactivateRule({ id: RULE }))
      .resolves.toBe(true);
    expect(boundary.reactivate).toHaveBeenCalledTimes(1);
    expect(boundary.reactivate).toHaveBeenCalledWith(TENANT_A, RULE, ACTOR);
    expect(boundary.get).not.toHaveBeenCalled();
  });

  // Planned normal case 23.
  it("seedCoastalRules forwards tenant A to every create without changing the list signature", async () => {
    const result = await api.createCaller(context("admin")).geoOverride.seedCoastalRules();
    expect(result).toMatchObject({ seeded: true });
    expect(boundary.list).toHaveBeenCalledTimes(1);
    expect(boundary.list).toHaveBeenCalledWith({ activeOnly: false });
    expect(boundary.create).toHaveBeenCalledTimes(COASTAL_OVERRIDE_SEED_RULES.length);
    for (const call of boundary.create.mock.calls) {
      expect(call[0]).toBe(TENANT_A);
      expect(call[2]).toBe(ACTOR);
    }
  });
});

describe("G2-1 normal update mapper", () => {
  // Planned normal cases 24-25.
  it.each([true, false])("maps active=%s to isActive without forwarding active", async active => {
    boundary.update.mockResolvedValue({ ...ruleRow, isActive: active });
    await api.createCaller(context("admin")).geoOverride.updateRule({ id: RULE, active });
    expect(boundary.update).toHaveBeenCalledWith(
      TENANT_A,
      RULE,
      { isActive: active },
      ACTOR,
    );
    expect(boundary.update.mock.calls[0][2]).not.toHaveProperty("active");
  });

  // Planned normal case 26.
  it("preserves an explicit null finishLevel", async () => {
    await api.createCaller(context("admin")).geoOverride.updateRule({ id: RULE, finishLevel: null });
    expect(boundary.update).toHaveBeenCalledWith(
      TENANT_A,
      RULE,
      { finishLevel: null },
      ACTOR,
    );
  });

  // Planned normal case 27.
  it("normalizes the existing prem finish-level alias to premium", async () => {
    await api.createCaller(context("admin")).geoOverride.updateRule({ id: RULE, finishLevel: "prem" });
    expect(boundary.update).toHaveBeenCalledWith(
      TENANT_A,
      RULE,
      { finishLevel: "premium" },
      ACTOR,
    );
  });

  // Planned normal case 28.
  it("normalizes the existing electric trade alias to electrical", async () => {
    await api.createCaller(context("admin")).geoOverride.updateRule({ id: RULE, trade: "electric" });
    expect(boundary.update).toHaveBeenCalledWith(
      TENANT_A,
      RULE,
      { trade: "electrical" },
      ACTOR,
    );
  });

  // Planned normal case 29.
  it("whitelists the public update payload and keeps protected keys out of the DB patch", async () => {
    const input = {
      id: RULE,
      zone: "Barrier Island Premium",
      trade: "electric",
      finishLevel: "prem",
      originalAssemblyId: ORIGINAL_ASSEMBLY,
      replacementAssemblyId: REPLACEMENT_ASSEMBLY,
      overrideType: "warning_only" as const,
      reasonTemplate: "Operator review required",
      active: false,
      tenantId: TENANT_B,
      createdAt: new Date("2000-01-01T00:00:00.000Z"),
      updatedAt: new Date("2000-01-02T00:00:00.000Z"),
    };

    await api.createCaller(context("admin")).geoOverride.updateRule(input);

    expect(boundary.update).toHaveBeenCalledTimes(1);
    expect(boundary.update).toHaveBeenCalledWith(
      TENANT_A,
      RULE,
      {
        zone: "Barrier Island Premium",
        trade: "electrical",
        finishLevel: "premium",
        originalAssemblyId: ORIGINAL_ASSEMBLY,
        replacementAssemblyId: REPLACEMENT_ASSEMBLY,
        overrideType: "warning_only",
        reasonTemplate: "Operator review required",
        isActive: false,
      },
      ACTOR,
    );
    const patch = boundary.update.mock.calls[0][2];
    expect(patch).not.toHaveProperty("id");
    expect(patch).not.toHaveProperty("active");
    expect(patch).not.toHaveProperty("tenantId");
    expect(patch).not.toHaveProperty("createdAt");
    expect(patch).not.toHaveProperty("updatedAt");
  });
});

describe("G2-1 normal unavailable-result mapping", () => {
  // Planned normal cases 30-33: all four point routes expose the same absence contract.
  it.each([
    ["getRule", () => {
      boundary.get.mockResolvedValue(null);
      return api.createCaller(context("user")).geoOverride.getRule({ id: RULE });
    }],
    ["updateRule", () => {
      boundary.update.mockResolvedValue(null);
      return api.createCaller(context("admin")).geoOverride.updateRule({ id: RULE, zone: "Charleston Metro" });
    }],
    ["deactivateRule", () => {
      boundary.deactivate.mockResolvedValue(false);
      return api.createCaller(context("admin")).geoOverride.deactivateRule({ id: RULE });
    }],
    ["reactivateRule", () => {
      boundary.reactivate.mockResolvedValue(false);
      return api.createCaller(context("admin")).geoOverride.reactivateRule({ id: RULE });
    }],
  ] as const)("%s maps an unavailable helper result to the uniform NOT_FOUND error", async (_name, invoke) => {
    await expect(invoke()).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Override rule not found",
    });
  });
});
