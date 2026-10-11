import { describe, expect, it } from "vitest";
import { parseCalculatorCoordinationManifest } from "../scripts/financial-executor-homologation/orchestration-contract";
const fixture = {
  version: "calculator-homologation-v1",
  operationId: "c8000000-0000-4000-8000-000000000001",
  sourceCommit: "a".repeat(40),
  expectedDatabase: "postgres",
  expectedPrincipal: "app_principal_runner",
  operator: {
    subject: "c9000000-0000-4000-8000-000000000001",
    actorId: "c9000000-0000-4000-8000-000000000002",
    tenantId: "c9000000-0000-4000-8000-000000000003",
  },
  window: {
    opensAt: "2026-10-10T12:00:00.000Z",
    closesAt: "2026-10-10T12:30:00.000Z",
  },
};
function manifest() {
  return {
    fixture: structuredClone(fixture),
    rbac: {
      ...structuredClone(fixture),
      version: "calculator-homologation-rbac-v1",
      operationId: "c8000000-0000-4000-8000-000000000002",
      operator: { ...fixture.operator, originalRole: "user" },
      nominalRole: "calculator_pilot_operator_v1",
      permissionMode: "create-absent",
      ids: {
        permission: "c8310000-0000-4000-8000-000000000001",
        role: "c8310000-0000-4000-8000-000000000002",
        edge: "c8310000-0000-4000-8000-000000000003",
      },
    },
  };
}
describe("Calculator coordination manifest", () => {
  it("preserves distinct operation identities and exact nominal operator", () => {
    const m = manifest();
    expect(parseCalculatorCoordinationManifest(m)).toEqual(m);
  });
  it.each([
    "operationId",
    "sourceCommit",
    "expectedPrincipal",
    "expectedDatabase",
    "subject",
    "actorId",
    "tenantId",
    "window",
    "syntheticCollision",
    "rbacCollision",
    "unknown",
  ])("rejects cross-manifest mismatch %s", kind => {
    const m: any = manifest();
    if (kind === "operationId") m.rbac.operationId = m.fixture.operationId;
    else if (kind === "sourceCommit") m.rbac.sourceCommit = "b".repeat(40);
    else if (kind === "expectedPrincipal")
      m.rbac.expectedPrincipal = "different_admin";
    else if (kind === "expectedDatabase") m.rbac.expectedDatabase = "other";
    else if (["subject", "actorId", "tenantId"].includes(kind))
      m.rbac.operator[kind] = "c9100000-0000-4000-8000-000000000001";
    else if (kind === "window")
      m.rbac.window.closesAt = "2026-10-10T12:40:00.000Z";
    else if (kind === "syntheticCollision")
      m.rbac.operationId = "c8300000-0000-4000-8000-000000000003";
    else if (kind === "rbacCollision")
      m.fixture.operationId = m.rbac.ids.permission;
    else m.secret = "must-not-be-accepted";
    expect(() => parseCalculatorCoordinationManifest(m)).toThrow();
  });
});

describe("administrative whole-transaction retry budget", () => {
  it("does not retry a serialization failure after the shared thirty-second deadline", async () => {
    const { vi } = await import("vitest");
    const { preflightCalculatorHomologation } = await import(
      "../scripts/financial-executor-homologation/admin"
    );
    let now = 100,
      attempts = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const db = {
      transaction: async () => {
        attempts++;
        now += 30001;
        throw Object.assign(new Error("serialization"), { code: "40001" });
      },
    };
    try {
      await expect(
        preflightCalculatorHomologation(db as any, fixture)
      ).rejects.toThrow("DEADLINE");
      expect(attempts).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });
  it.each(["40001", "40P01"])(
    "bounds %s retries to three complete transaction attempts",
    async code => {
      const { preflightCalculatorHomologation } = await import(
        "../scripts/financial-executor-homologation/admin"
      );
      let attempts = 0;
      const db = {
        transaction: async () => {
          attempts++;
          throw Object.assign(new Error("retryable"), { cause: { code } });
        },
      };
      await expect(
        preflightCalculatorHomologation(db as any, fixture)
      ).rejects.toThrow("retryable");
      expect(attempts).toBe(3);
    }
  );
  it.each(["08006", "42501", "57014"])(
    "does not resubmit uncertain/nonretryable %s outcomes",
    async code => {
      const { preflightCalculatorHomologation } = await import(
        "../scripts/financial-executor-homologation/admin"
      );
      let attempts = 0;
      const db = {
        transaction: async () => {
          attempts++;
          throw Object.assign(new Error("not-retryable"), { code });
        },
      };
      await expect(
        preflightCalculatorHomologation(db as any, fixture)
      ).rejects.toThrow("not-retryable");
      expect(attempts).toBe(1);
    }
  );
});

describe("RBAC whole-transaction deadline", () => {
  it("shares thirty seconds across retries without using the manifest expiry for withdrawal", async () => {
    const { vi } = await import("vitest");
    const { withdrawCalculatorRbac } = await import(
      "../scripts/financial-executor-homologation-rbac"
    );
    let now = 100,
      attempts = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const db = {
      transaction: async () => {
        attempts++;
        now += 30001;
        throw Object.assign(new Error("serialization"), { code: "40001" });
      },
    };
    try {
      await expect(
        withdrawCalculatorRbac(db as any, manifest().rbac)
      ).rejects.toThrow("DEADLINE");
      expect(attempts).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("paired receipt transaction budgets", () => {
  it("does not start a second evidence transaction after the shared budget expires", async () => {
    const { vi } = await import("vitest");
    const { withdrawCalculatorPilot } = await import(
      "../scripts/financial-executor-homologation/orchestration"
    );
    let now = 1,
      attempts = 0;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const db = {
      transaction: async () => {
        attempts++;
        now += 30001;
        throw Object.assign(new Error("serialization"), { code: "40001" });
      },
    };
    try {
      await expect(
        withdrawCalculatorPilot(db as any, manifest())
      ).rejects.toThrow("DEADLINE");
      expect(attempts).toBe(1);
    } finally {
      clock.mockRestore();
    }
  });
  it.each(["40001", "40P01"])(
    "retries the complete receipt transaction at most three times for %s",
    async code => {
      const { withdrawCalculatorPilot } = await import(
        "../scripts/financial-executor-homologation/orchestration"
      );
      let attempts = 0;
      const db = {
        transaction: async () => {
          attempts++;
          throw Object.assign(new Error("retryable"), { cause: { code } });
        },
      };
      await expect(
        withdrawCalculatorPilot(db as any, manifest())
      ).rejects.toThrow("retryable");
      expect(attempts).toBe(3);
    }
  );
});
