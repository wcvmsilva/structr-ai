/**
 * Route-boundary proof only: the router, middleware, scope resolver and lead
 * engine are real. Profile eligibility and commercial persistence are doubles.
 * The companion PostgreSQL suite proves the real profile query/state behavior.
 *
 * The legacy helper deliberately succeeds, so the same tests on the baseline
 * fail because lead.create continues, not because a new export is unavailable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError, type inferRouterInputs } from "@trpc/server";
import type { Lead, Profile } from "../drizzle/schema";
import type { TrpcContext } from "./_core/context";

const boundary = vi.hoisted(() => {
  class LeadProfileError extends Error {
    constructor(readonly code: "PROFILE_NOT_ALLOWED" | "DB_UNAVAILABLE") {
      super(code === "PROFILE_NOT_ALLOWED" ? "Profile is not allowed" : "Profile service unavailable");
      this.name = "LeadProfileError";
    }
  }

  return {
    LeadProfileError,
    requireExistingLeadProfile: vi.fn<(userId: string, tenantId: string) => Promise<void>>(),
    ensureProfileExists: vi.fn<(userId: string, fullName: string) => Promise<void>>(),
    listLeads: vi.fn<typeof import("./lead-db").listLeads>(),
    createLead: vi.fn<typeof import("./lead-db").createLead>(),
  };
});

vi.mock("./lead-db", () => boundary);
// Prevent unrelated imported route modules from acquiring any real connection.
vi.mock("./db", () => ({ getDb: vi.fn(), getRawClient: vi.fn() }));

import { leadRouter } from "./lead-router";

const ACTOR = "30000000-0000-4000-8000-000000000001";
const TENANT = "20000000-0000-4000-8000-000000000001";
const OTHER_ACTOR = "30000000-0000-4000-8000-000000000002";
const OTHER_TENANT = "20000000-0000-4000-8000-000000000002";
const validInput = { firstName: "Robin", lastName: "River", email: "robin@example.test" };
type CreateInput = inferRouterInputs<typeof leadRouter>["create"];

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: ACTOR,
    tenantId: TENANT,
    externalOpenId: "external-auth-subject",
    email: "operator@example.test",
    loginMethod: "admin-provisioned",
    fullName: "Provisioned Operator",
    companyName: null,
    role: "user",
    isActive: true,
    lastSignedIn: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  };
}

function context(overrides: Partial<TrpcContext> = {}): TrpcContext {
  return {
    req: {} as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    user: profile(),
    tenantId: TENANT,
    authProvider: "supabase",
    ...overrides,
  };
}

async function rejectedCreate(
  ctx: TrpcContext,
  code: TRPCError["code"],
  input: CreateInput = validInput,
): Promise<TRPCError> {
  const result = await leadRouter.createCaller(ctx).create(input).then(
    value => value,
    error => error as unknown,
  );
  expect(result).toBeInstanceOf(TRPCError);
  expect(result).toMatchObject({ code });
  return result as TRPCError;
}

function expectNoBusinessAccess() {
  expect(boundary.listLeads).not.toHaveBeenCalled();
  expect(boundary.createLead).not.toHaveBeenCalled();
}

function expectNoProfileAccess() {
  expect(boundary.requireExistingLeadProfile).not.toHaveBeenCalled();
  expect(boundary.ensureProfileExists).not.toHaveBeenCalled();
}

function expectOneCall(mock: { mock: { calls: unknown[][] } }, ...args: unknown[]) {
  expect(mock).toHaveBeenCalledTimes(1);
  expect(mock).toHaveBeenCalledWith(...args);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("LEADS_OWNER_SCOPE", "false");
  boundary.ensureProfileExists.mockResolvedValue(undefined);
  boundary.requireExistingLeadProfile.mockResolvedValue(undefined);
  boundary.listLeads.mockResolvedValue([]);
  boundary.createLead.mockImplementation(async data => ({ id: "created-lead", ...data }) as Lead);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("lead.create profile precondition — real router boundary", () => {
  it("rejects a missing authenticated user before profile or business access", async () => {
    await rejectedCreate(context({ user: null }), "UNAUTHORIZED");
    expectNoProfileAccess();
    expectNoBusinessAccess();
  });

  it("rejects an authenticated context without an internal actor ID", async () => {
    await rejectedCreate(context({ user: profile({ id: "" }) }), "FORBIDDEN");
    expectNoProfileAccess();
    expectNoBusinessAccess();
  });

  it.each(["user", "admin"])("rejects a %s without any resolved tenant before profile access", async role => {
    await rejectedCreate(context({ user: profile({ role, tenantId: null }), tenantId: null }), "FORBIDDEN");
    expectNoProfileAccess();
    expectNoBusinessAccess();
  });

  it("keeps input validation ahead of profile and business access", async () => {
    await rejectedCreate(context(), "BAD_REQUEST", { ...validInput, email: "not-an-email" });
    expectNoProfileAccess();
    expectNoBusinessAccess();
  });

  it.each(["user", "admin"])("preserves the lead result for an eligible %s", async role => {
    const expected = { id: "persisted-lead", name: "Robin River", status: "new" } as Lead;
    boundary.createLead.mockResolvedValue(expected);

    const result = await leadRouter.createCaller(context({ user: profile({ role }) })).create(validInput);

    expect(result).toEqual(expected);
    expectOneCall(boundary.requireExistingLeadProfile, ACTOR, TENANT);
    expectOneCall(boundary.listLeads, {
      userId: ACTOR, tenantId: TENANT, via: role === "admin" ? "admin" : "tenant",
    });
    expectOneCall(boundary.createLead, expect.objectContaining({
      ownerUserId: ACTOR, tenantId: TENANT, name: "Robin River", email: validInput.email,
    }), ACTOR);
    expect(boundary.requireExistingLeadProfile.mock.invocationCallOrder[0])
      .toBeLessThan(boundary.listLeads.mock.invocationCallOrder[0]);
    expect(boundary.listLeads.mock.invocationCallOrder[0])
      .toBeLessThan(boundary.createLead.mock.invocationCallOrder[0]);
    expect(boundary.ensureProfileExists).not.toHaveBeenCalled();
  });

  it("maps profile denial to FORBIDDEN and stops all business access", async () => {
    boundary.requireExistingLeadProfile.mockRejectedValue(new boundary.LeadProfileError("PROFILE_NOT_ALLOWED"));

    const error = await rejectedCreate(context(), "FORBIDDEN");

    expect(error.cause).toBeUndefined();
    expectOneCall(boundary.requireExistingLeadProfile, ACTOR, TENANT);
    expect(boundary.ensureProfileExists).not.toHaveBeenCalled();
    expectNoBusinessAccess();
  });

  it("denies an ineligible admin before revealing a duplicate lead", async () => {
    boundary.requireExistingLeadProfile.mockRejectedValue(new boundary.LeadProfileError("PROFILE_NOT_ALLOWED"));
    boundary.listLeads.mockResolvedValue([{ id: "existing-lead", email: validInput.email }] as Lead[]);

    await rejectedCreate(context({ user: profile({ role: "admin" }) }), "FORBIDDEN");

    expectOneCall(boundary.requireExistingLeadProfile, ACTOR, TENANT);
    expect(boundary.ensureProfileExists).not.toHaveBeenCalled();
    expectNoBusinessAccess();
  });

  it.each([
    ["typed DB unavailability", () => new boundary.LeadProfileError("DB_UNAVAILABLE")],
    ["unexpected query failure", () => new Error("SELECT secret_token FROM profiles; password=route-secret")],
    ["unexpected tRPC error", () => new TRPCError({ code: "BAD_REQUEST", message: "raw-sql route-secret" })],
  ] as const)("sanitizes %s and stops all business access", async (_label, makeError) => {
    const rawError = makeError();
    boundary.requireExistingLeadProfile.mockRejectedValue(rawError);

    const error = await rejectedCreate(context(), "INTERNAL_SERVER_ERROR");

    expect(error).not.toBe(rawError);
    expect(error.cause).toBeUndefined();
    expect(error.message).not.toMatch(/SELECT|secret_token|password=|raw-sql|route-secret/);
    expectOneCall(boundary.requireExistingLeadProfile, ACTOR, TENANT);
    expect(boundary.ensureProfileExists).not.toHaveBeenCalled();
    expectNoBusinessAccess();
  });

  it("ignores payload role, tenant and actor IDs in the precondition and inserted owner", async () => {
    const spoofedInput = {
      ...validInput,
      role: "admin",
      tenantId: OTHER_TENANT,
      userId: OTHER_ACTOR,
      ownerUserId: OTHER_ACTOR,
      externalOpenId: OTHER_ACTOR,
    };

    const result = await leadRouter.createCaller(context()).create(spoofedInput);

    expectOneCall(boundary.requireExistingLeadProfile, ACTOR, TENANT);
    expectOneCall(boundary.listLeads, { userId: ACTOR, tenantId: TENANT, via: "tenant" });
    expect(result).toMatchObject({ ownerUserId: ACTOR, tenantId: TENANT });
    const [payload, actorId] = boundary.createLead.mock.calls[0];
    expect(actorId).toBe(ACTOR);
    expect(payload).not.toHaveProperty("role");
    expect(payload).not.toHaveProperty("userId");
    expect(payload).not.toHaveProperty("externalOpenId");
    expect(boundary.ensureProfileExists).not.toHaveBeenCalled();
  });

  it("uses the scope resolver's profile tenant fallback for both eligibility and insertion", async () => {
    const result = await leadRouter.createCaller(context({ tenantId: null })).create(validInput);

    expectOneCall(boundary.requireExistingLeadProfile, ACTOR, TENANT);
    expectOneCall(boundary.listLeads, { userId: ACTOR, tenantId: TENANT, via: "tenant" });
    expect(result).toMatchObject({ ownerUserId: ACTOR, tenantId: TENANT });
    expectOneCall(boundary.createLead, expect.objectContaining({
      ownerUserId: ACTOR, tenantId: TENANT,
    }), ACTOR);
  });

  it("preserves duplicate CONFLICT only after the profile precondition succeeds", async () => {
    boundary.listLeads.mockResolvedValue([{ id: "existing-lead", email: validInput.email }] as Lead[]);

    await rejectedCreate(context(), "CONFLICT");

    expectOneCall(boundary.requireExistingLeadProfile, ACTOR, TENANT);
    expectOneCall(boundary.listLeads, { userId: ACTOR, tenantId: TENANT, via: "tenant" });
    expect(boundary.requireExistingLeadProfile.mock.invocationCallOrder[0])
      .toBeLessThan(boundary.listLeads.mock.invocationCallOrder[0]);
    expect(boundary.createLead).not.toHaveBeenCalled();
    expect(boundary.ensureProfileExists).not.toHaveBeenCalled();
  });
});
