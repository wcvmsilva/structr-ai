import { describe, expect, it } from "vitest";
import {
  parseCalculatorHomologationManifest,
  planCalculatorHomologation,
  SYNTHETIC_IDS,
} from "../scripts/financial-executor-homologation/contract";
export const manifest = () => ({
  version: "calculator-homologation-v1",
  operationId: "c8000000-0000-4000-8000-000000000001",
  sourceCommit: "9fb9f656" + "0".repeat(32),
  expectedDatabase: "postgres",
  expectedPrincipal: "app_principal_runner",
  operator: {
    subject: "c9000000-0000-4000-8000-000000000001",
    actorId: "c9000000-0000-4000-8000-000000000002",
    tenantId: "c9000000-0000-4000-8000-000000000003",
  },
  window: {
    opensAt: "2026-10-10T12:00:00.000Z",
    closesAt: "2026-10-10T13:00:00.000Z",
  },
});
describe("calculator homologation private contract", () => {
  it("plans only fixed synthetic data without exposing the protected O mapping", () => {
    const p = planCalculatorHomologation(manifest());
    expect(p).toMatchObject({
      status: "planned",
      operations: [
        "calculator.context",
        "calculator.calculate",
        "calculator.create",
        "calculator.recover",
      ],
      fixture: {
        projectId: SYNTHETIC_IDS.project,
        intakeFormId: SYNTHETIC_IDS.intake,
        assemblies: [
          { label: "A", id: SYNTHETIC_IDS.a, cost: "40.00", price: "100.00" },
          { label: "B", id: SYNTHETIC_IDS.b, cost: "60.00", price: "90.00" },
          { label: "C", id: SYNTHETIC_IDS.c, cost: "0.01", price: "0.01" },
        ],
      },
      hostedReady: false,
    });
    expect(JSON.stringify(p)).not.toContain(manifest().operator.subject);
    expect(JSON.stringify(p)).not.toContain(manifest().operator.actorId);
  });
  it("canonicalizes key order but binds the source and window", () => {
    const m = manifest(),
      a = planCalculatorHomologation(m);
    expect(
      planCalculatorHomologation({
        ...m,
        operator: {
          tenantId: m.operator.tenantId,
          actorId: m.operator.actorId,
          subject: m.operator.subject,
        },
      }).manifestHash
    ).toBe(a.manifestHash);
    expect(
      planCalculatorHomologation({ ...m, sourceCommit: "a".repeat(40) })
        .manifestHash
    ).not.toBe(a.manifestHash);
    expect(
      planCalculatorHomologation({
        ...m,
        window: { ...m.window, closesAt: "2026-10-10T13:01:00.000Z" },
      }).manifestHash
    ).not.toBe(a.manifestHash);
  });
  it.each([
    ["unknown root", (m: any) => ({ ...m, sql: "DROP TABLE public.profiles" })],
    [
      "unknown operator",
      (m: any) => ({ ...m, operator: { ...m.operator, role: "admin" } }),
    ],
    ["caller rows", (m: any) => ({ ...m, fixtures: [] })],
    ["secret", (m: any) => ({ ...m, password: "secret" })],
    [
      "role injection",
      (m: any) => ({ ...m, expectedPrincipal: "postgres; DROP ROLE anon" }),
    ],
    [
      "nil operator",
      (m: any) => ({
        ...m,
        operator: {
          ...m.operator,
          subject: "00000000-0000-0000-0000-000000000000",
        },
      }),
    ],
    [
      "fixture collision",
      (m: any) => ({
        ...m,
        operator: { ...m.operator, actorId: SYNTHETIC_IDS.project },
      }),
    ],
    [
      "operator collision",
      (m: any) => ({
        ...m,
        operator: { ...m.operator, actorId: m.operator.subject },
      }),
    ],
    [
      "reversed window",
      (m: any) => ({
        ...m,
        window: { opensAt: m.window.closesAt, closesAt: m.window.opensAt },
      }),
    ],
    [
      "unbounded window",
      (m: any) => ({
        ...m,
        window: { ...m.window, closesAt: "2026-10-12T12:00:00.000Z" },
      }),
    ],
    ["short source", (m: any) => ({ ...m, sourceCommit: "9fb9f656" })],
  ] as const)("rejects %s", (_, change) => {
    expect(() =>
      parseCalculatorHomologationManifest(change(manifest()))
    ).toThrow("CALCULATOR_HOMOLOGATION_MANIFEST_INVALID");
  });
});
