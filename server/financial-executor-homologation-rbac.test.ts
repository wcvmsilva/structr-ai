import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseCalculatorRbacManifest,
  planCalculatorRbac,
} from "../scripts/financial-executor-homologation-rbac";
import { getAuthenticatedDataApiSession } from "./authenticated-data-api";
import { authRouter } from "./auth-router";
import { router } from "./_core/trpc";
const make = () => ({
  version: "calculator-homologation-rbac-v1",
  operationId: "c8310000-0000-4000-8000-000000000010",
  sourceCommit: "9fb9f6564b44945aa894341b3dea73d929fd3d2b",
  expectedDatabase: "postgres",
  expectedPrincipal: "app_principal_runner",
  operator: {
    subject: "c8310000-0000-4000-8000-000000000011",
    actorId: "c8310000-0000-4000-8000-000000000012",
    tenantId: "c8310000-0000-4000-8000-000000000013",
    originalRole: "user",
  },
  nominalRole: "calculator_pilot_operator_v1",
  permissionMode: "create-absent",
  ids: {
    permission: "c8310000-0000-4000-8000-000000000001",
    role: "c8310000-0000-4000-8000-000000000002",
    edge: "c8310000-0000-4000-8000-000000000003",
  },
  window: {
    opensAt: "2026-10-10T12:00:00.000Z",
    closesAt: "2026-10-10T13:00:00.000Z",
  },
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("isolated Calculator RBAC candidate contract", () => {
  it("plans a bounded zero-state change without claiming target or source verification", () => {
    const m = make();
    expect(parseCalculatorRbacManifest(m)).toEqual(m);
    const p = planCalculatorRbac(m);
    expect(p).toMatchObject({
      status: "planned",
      hostedReady: false,
      sourceAttested: false,
      operationId: m.operationId,
      changes: [
        "permission.create",
        "role.create",
        "role_permission.create",
        "profile.role.assign",
      ],
      withdrawal: ["role_permission.delete", "profile.role.restore"],
    });
    expect(p.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(p)).not.toContain(m.operator.subject);
  });
  it("binds payload and source while ignoring object-key order", () => {
    const m = make(),
      h = planCalculatorRbac(m).manifestHash;
    expect(
      planCalculatorRbac(Object.fromEntries(Object.entries(m).reverse()))
        .manifestHash
    ).toBe(h);
    expect(
      planCalculatorRbac({ ...m, sourceCommit: "a".repeat(40) }).manifestHash
    ).not.toBe(h);
  });
  it.each([
    [
      "extra secret",
      (m: any) => {
        m.password = "do-not-echo";
      },
    ],
    [
      "nested secret",
      (m: any) => {
        m.operator.token = "do-not-echo";
      },
    ],
    [
      "admin original",
      (m: any) => {
        m.operator.originalRole = "admin";
      },
    ],
    [
      "shared role",
      (m: any) => {
        m.nominalRole = "user";
      },
    ],
    [
      "reuse mode",
      (m: any) => {
        m.permissionMode = "reuse";
      },
    ],
    [
      "foreign permission id",
      (m: any) => {
        m.ids.permission = m.operationId;
      },
    ],
    [
      "nil identity",
      (m: any) => {
        m.operator.subject = "00000000-0000-0000-0000-000000000000";
      },
    ],
    [
      "colliding identity",
      (m: any) => {
        m.operator.actorId = m.operator.subject;
      },
    ],
    [
      "fixed-id collision",
      (m: any) => {
        m.operator.actorId = m.ids.role;
      },
    ],
    [
      "long window",
      (m: any) => {
        m.window.closesAt = "2026-10-10T14:00:00.001Z";
      },
    ],
    [
      "reversed window",
      (m: any) => {
        m.window.closesAt = m.window.opensAt;
      },
    ],
    [
      "source shorthand",
      (m: any) => {
        m.sourceCommit = "9fb9f656";
      },
    ],
    [
      "principal injection",
      (m: any) => {
        m.expectedPrincipal = "postgres;select 1";
      },
    ],
  ] as const)("refuses %s before a database is used", (_, change) => {
    const m = make();
    change(m);
    expect(() => parseCalculatorRbacManifest(m)).toThrow(
      "CALCULATOR_RBAC_MANIFEST_INVALID"
    );
  });
  it("existing Data API parser and auth.me retain the nominal role, exact permission and non-admin identity", async () => {
    for (const [key, value] of Object.entries({
      STRUCTR_DATABASE_MODE: "authenticated-data-api",
      AUTH_PROVIDER: "supabase",
      TENANT_STRICT: "true",
      SUPABASE_URL: "https://rbac-local.invalid",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local",
    }))
      vi.stubEnv(key, value);
    const m = make(),
      date = "2026-10-10T12:00:00.000Z";
    const envelope = {
      version: "structr-authenticated-session-v1",
      profile: {
        id: m.operator.actorId,
        tenantId: m.operator.tenantId,
        externalOpenId: m.operator.subject,
        email: null,
        loginMethod: null,
        fullName: "Synthetic operator",
        companyName: null,
        role: m.nominalRole,
        isActive: true,
        lastSignedIn: null,
        createdAt: date,
        updatedAt: date,
      },
      tenantId: m.operator.tenantId,
      permissions: { slugs: ["estimate:create"], isPlatformAdmin: false },
    };
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify(envelope), { status: 200 })
    );
    const session = await getAuthenticatedDataApiSession({
      headers: { authorization: "Bearer a.b.c" },
    });
    const caller = router({ auth: authRouter }).createCaller({
      user: session.profile,
      tenantId: session.tenantId,
      authenticatedDataApiSession: session,
      authProvider: "supabase",
      req: { headers: {} },
      res: {},
    } as any);
    expect(await caller.auth.me()).toMatchObject({
      role: "calculator_pilot_operator_v1",
      permissions: ["estimate:create"],
      id: m.operator.actorId,
      tenantId: m.operator.tenantId,
    });
    expect(session.permissions.isPlatformAdmin).toBe(false);
    envelope.permissions.isPlatformAdmin = true;
    await expect(
      getAuthenticatedDataApiSession({
        headers: { authorization: "Bearer a.b.c" },
      })
    ).rejects.toMatchObject({ kind: "unauthorized" });
  });
});
