/**
 * IF-1 integration gate.
 *
 * Two behaviours are proven here, both closed by default:
 *   1. `isIntakeFormationEnabled` — a pure reader over the process environment. It
 *      is true only for the authenticated Data API mode together with the exact
 *      string "true"; nothing else enables the named formation.
 *   2. The existing `baseProcedure` boundary in server/_core/trpc.ts — when that
 *      gate is open it additionally admits exactly one mutation, `intake.create`.
 *      Every other write, every type/path mismatch and direct mode stay as they are.
 *
 * The gate is an admission boundary, not an authorization source: SQL remains the
 * final RBAC authority and the authenticated transaction revalidates identity.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  router,
  publicProcedure,
  protectedProcedure,
  tenantProcedure,
  adminProcedure,
  adminTenantProcedure,
  TENANT_UNRESOLVED_ERR_MSG,
} from "./_core/trpc";
import { isIntakeFormationEnabled } from "./_core/database-mode";
import type { TrpcContext } from "./_core/context";

const AUTHENTICATED = "authenticated-data-api";
const user = {
  id: "a1000000-0000-4000-8000-000000000001",
  tenantId: "b1000000-0000-4000-8000-000000000001",
  role: "admin",
  isActive: true,
};

function context(overrides: Partial<TrpcContext> = {}): TrpcContext {
  return {
    req: { headers: {} },
    res: {},
    user,
    tenantId: user.tenantId,
    authProvider: "supabase",
    ...overrides,
  } as TrpcContext;
}

/** Open the real server gate through the environment the reader actually consumes. */
function openGate(): void {
  vi.stubEnv("STRUCTR_DATABASE_MODE", AUTHENTICATED);
  vi.stubEnv("STRUCTR_INTAKE_FORMATION_ENABLED", "true");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("IF-1 server gate reader", () => {
  it("is closed when nothing is configured", () => {
    expect(isIntakeFormationEnabled({})).toBe(false);
  });

  it("is closed in the existing direct database mode even with the flag set", () => {
    expect(
      isIntakeFormationEnabled({
        STRUCTR_DATABASE_MODE: "direct",
        STRUCTR_INTAKE_FORMATION_ENABLED: "true",
      }),
    ).toBe(false);
  });

  it("is closed in the authenticated mode while the flag is absent", () => {
    expect(isIntakeFormationEnabled({ STRUCTR_DATABASE_MODE: AUTHENTICATED })).toBe(false);
  });

  it("is open only for the authenticated mode with the exact flag value", () => {
    expect(
      isIntakeFormationEnabled({
        STRUCTR_DATABASE_MODE: AUTHENTICATED,
        STRUCTR_INTAKE_FORMATION_ENABLED: "true",
      }),
    ).toBe(true);
  });

  it.each(["TRUE", "True", "1", "yes", "on", "enabled", " true", "true ", "false", ""])(
    "treats the flag value %j as closed",
    value => {
      expect(
        isIntakeFormationEnabled({
          STRUCTR_DATABASE_MODE: AUTHENTICATED,
          STRUCTR_INTAKE_FORMATION_ENABLED: value,
        }),
      ).toBe(false);
    },
  );

  it.each(["", "Authenticated-Data-API", "authenticated_data_api", "data-api", "unsupported"])(
    "treats the database mode %j as closed",
    value => {
      expect(
        isIntakeFormationEnabled({
          STRUCTR_DATABASE_MODE: value,
          STRUCTR_INTAKE_FORMATION_ENABLED: "true",
        }),
      ).toBe(false);
    },
  );

  it("reads the live process environment by default", () => {
    expect(isIntakeFormationEnabled()).toBe(false);
    vi.stubEnv("STRUCTR_DATABASE_MODE", AUTHENTICATED);
    expect(isIntakeFormationEnabled()).toBe(false);
    vi.stubEnv("STRUCTR_INTAKE_FORMATION_ENABLED", "true");
    expect(isIntakeFormationEnabled()).toBe(true);
  });

  it("does not write to the environment it reads", () => {
    const before = JSON.stringify(process.env);
    isIntakeFormationEnabled();
    expect(JSON.stringify(process.env)).toBe(before);
  });
});

describe.each([
  ["public", publicProcedure],
  ["protected", protectedProcedure],
  ["tenant", tenantProcedure],
  ["admin", adminProcedure],
  ["adminTenant", adminTenantProcedure],
] as const)("IF-1 admission on the %s base", (_name, base) => {
  const formation = (onCall: () => void) =>
    router({ intake: router({ create: base.mutation(() => { onCall(); return { id: "created" }; }) }) });

  it("admits the named intake.create mutation while the gate is open", async () => {
    openGate();
    let called = false;
    const api = formation(() => { called = true; });
    expect(await api.createCaller(context()).intake.create()).toEqual({ id: "created" });
    expect(called).toBe(true);
  });

  it("blocks the same mutation while the gate is closed by default", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", AUTHENTICATED);
    let called = false;
    const api = formation(() => { called = true; });
    await expect(api.createCaller(context()).intake.create()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(called).toBe(false);
  });
});

describe("IF-1 admission is exactly one mutation", () => {
  const effects = { calls: [] as string[] };
  const api = router({
    intake: router({
      create: tenantProcedure.mutation(() => { effects.calls.push("intake.create"); return "formed"; }),
      createDraft: tenantProcedure.mutation(() => { effects.calls.push("intake.createDraft"); return "drafted"; }),
      Create: tenantProcedure.mutation(() => { effects.calls.push("intake.Create"); return "cased"; }),
      update: tenantProcedure.mutation(() => { effects.calls.push("intake.update"); return "updated"; }),
      list: tenantProcedure.query(() => { effects.calls.push("intake.list"); return "listed"; }),
      constructor: tenantProcedure.mutation(() => { effects.calls.push("intake.constructor"); return "polluted"; }),
    }),
    create: tenantProcedure.mutation(() => { effects.calls.push("create"); return "bare"; }),
    client: router({ create: tenantProcedure.mutation(() => { effects.calls.push("client.create"); return "client"; }) }),
    estimate: router({
      approveEstimate: adminProcedure.mutation(() => { effects.calls.push("estimate.approveEstimate"); return "approved"; }),
      getById: tenantProcedure.query(() => { effects.calls.push("estimate.getById"); return "read"; }),
    }),
    auth: router({
      session: publicProcedure.query(() => { effects.calls.push("auth.session"); return "descriptor"; }),
      logout: publicProcedure.mutation(() => { effects.calls.push("auth.logout"); return "logged-out"; }),
    }),
  });
  type Caller = ReturnType<typeof api.createCaller>;
  const caller = () => api.createCaller(context());

  afterEach(() => {
    effects.calls = [];
  });

  it.each([
    ["a mutation named like the formation on another router", (c: Caller) => c.client.create()],
    ["a sibling intake mutation", (c: Caller) => c.intake.update()],
    ["a longer intake mutation name", (c: Caller) => c.intake.createDraft()],
    ["a differently cased intake mutation", (c: Caller) => c.intake.Create()],
    ["a prototype-shaped intake mutation name", (c: Caller) => c.intake.constructor()],
    ["the bare create path", (c: Caller) => c.create()],
    ["the existing approval mutation", (c: Caller) => c.estimate.approveEstimate()],
    ["the cookie-only logout mutation", (c: Caller) => c.auth.logout()],
    ["an unrelated intake query", (c: Caller) => c.intake.list()],
  ] as const)("still blocks %s with the gate open", async (_name, invoke) => {
    openGate();
    await expect(invoke(caller())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(effects.calls).toEqual([]);
  });

  it("does not admit a query at the formation path", async () => {
    openGate();
    const queryApi = router({
      intake: router({ create: tenantProcedure.query(() => { effects.calls.push("intake.create"); return "read"; }) }),
    });
    await expect(queryApi.createCaller(context()).intake.create()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(effects.calls).toEqual([]);
  });

  it("keeps the existing named read allowlist reachable", async () => {
    openGate();
    expect(await caller().auth.session()).toBe("descriptor");
    expect(await caller().estimate.getById()).toBe("read");
  });

  it("still requires an authenticated user for the admitted formation", async () => {
    openGate();
    await expect(
      api.createCaller(context({ user: null })).intake.create(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(effects.calls).toEqual([]);
  });

  it("still requires a resolved tenant for the admitted formation", async () => {
    openGate();
    await expect(
      api.createCaller(context({ tenantId: null })).intake.create(),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: TENANT_UNRESOLVED_ERR_MSG });
    expect(effects.calls).toEqual([]);
  });

  it("leaves direct mode dispatch unchanged, flag set or not", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    vi.stubEnv("STRUCTR_INTAKE_FORMATION_ENABLED", "true");
    expect(await caller().estimate.approveEstimate()).toBe("approved");
    expect(await caller().intake.update()).toBe("updated");
    expect(await caller().intake.create()).toBe("formed");
    expect(effects.calls).toEqual(["estimate.approveEstimate", "intake.update", "intake.create"]);
  });
});
