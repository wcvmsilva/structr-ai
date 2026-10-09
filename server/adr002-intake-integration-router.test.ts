/**
 * IF-1 integration of the existing `intake.create` endpoint.
 *
 * Under the authenticated Data API boundary, and only while the server gate is
 * open, the `newProject` branch forms the intake through the named RPC
 * `public.structr_intake_create_v1(preimage text)` and decodes its envelope with
 * the real decoder. The legacy Drizzle formation, RBAC lookup, client lookup,
 * project-access helper, geocoding and extra audit are not reached on that branch;
 * direct mode keeps its current behaviour, geocoding included.
 *
 * The guard, the gate and the decoder under test are never mocked here. Only the
 * external side effects (the HTTP RPC, the DB helpers, geocoding, audit) are
 * replaced by behavioural spies so that reaching them is observable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { TrpcContext } from "./_core/context";

const io = vi.hoisted(() => ({
  rpc: vi.fn(),
  createForm: vi.fn(),
  permission: vi.fn(),
  client: vi.fn(),
  access: vi.fn(),
  address: vi.fn(),
  geocode: vi.fn(),
  persistGeo: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("./authenticated-data-api", async original => ({
  ...(await original<typeof import("./authenticated-data-api")>()),
  callAuthenticatedIntakeCreate: io.rpc,
}));
vi.mock("./intake-db", async original => ({
  ...(await original<typeof import("./intake-db")>()),
  createIntakeForm: io.createForm,
}));
vi.mock("./rbac", async original => ({
  ...(await original<typeof import("./rbac")>()),
  requirePermission: io.permission,
}));
vi.mock("./client-db", async original => ({
  ...(await original<typeof import("./client-db")>()),
  getClientById: io.client,
}));
vi.mock("./project-access", async original => ({
  ...(await original<typeof import("./project-access")>()),
  requireProjectAccessTrpc: io.access,
}));
vi.mock("./geo-integration", async original => ({
  ...(await original<typeof import("./geo-integration")>()),
  geocodeAndDetectZone: io.geocode,
  persistGeocodeResult: io.persistGeo,
}));
vi.mock("./geo-geocoding", async original => ({
  ...(await original<typeof import("./geo-geocoding")>()),
  validateAddressForGeocoding: io.address,
}));
vi.mock("./audit", async original => ({
  ...(await original<typeof import("./audit")>()),
  logAudit: io.audit,
}));

import { appRouter } from "./routers";
import { AuthenticatedDataApiError } from "./authenticated-data-api";
import { serializeIntakeFormationPreimage } from "@shared/intake-formation-engine";

const actorId = "a1000000-0000-4000-8000-000000000001";
const tenantId = "b1000000-0000-4000-8000-000000000001";
const requestId = "c1000000-0000-4000-8000-000000000001";
const projectId = "d1000000-0000-4000-8000-000000000001";
const otherId = "e1000000-0000-4000-8000-000000000001";
const identity = { actorId, tenantId };

/** The exact validated command this packet freezes; bytes below are derived from it. */
const command = {
  requestId,
  newProject: {
    name: "Synthetic formation",
    projectType: "repair" as const,
    client: { firstName: "Synthetic", lastName: "Customer" },
    address: "1 Synthetic Formation Lane",
  },
  serviceType: "repair",
  rawPayload: { description: "Synthetic fixture only" },
};

/** Frozen independently of the implementation under test (see the first test). */
const FROZEN_PREIMAGE =
  '{"requestId":"c1000000-0000-4000-8000-000000000001","newProject":{"name":"Synthetic formation","projectType":"repair","client":{"firstName":"Synthetic","lastName":"Customer"},"address":"1 Synthetic Formation Lane"},"serviceType":"repair","rawPayload":{"description":"Synthetic fixture only"},"tenantId":"b1000000-0000-4000-8000-000000000001","userId":"a1000000-0000-4000-8000-000000000001"}';
const FROZEN_FINGERPRINT = "ebdc7cbf49d1f67513ec164b215b16bbb6ec7315f5dae395b4326d28032dde0c";

type Wire = {
  version: string;
  context: { actorId: string; tenantId: string };
  intake: {
    id: string;
    tenantId: string;
    leadId: string | null;
    projectId: string | null;
    status: string;
    formData: Record<string, unknown>;
    createdAt: string;
    updatedAt: string;
  };
};

function wire(): Wire {
  return {
    version: "structr-authenticated-intake-create-v1",
    context: { actorId, tenantId },
    intake: {
      id: requestId,
      tenantId,
      leadId: null,
      projectId,
      status: "draft",
      formData: {
        creationFingerprint: FROZEN_FINGERPRINT,
        serviceType: "repair",
        area: null,
        condition: null,
        notes: null,
      },
      createdAt: "2026-10-09T12:00:00.000Z",
      updatedAt: "2026-10-09T12:00:00.000Z",
    },
  };
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: actorId,
    tenantId,
    externalOpenId: "f1000000-0000-4000-8000-000000000001",
    email: null,
    loginMethod: null,
    fullName: "Synthetic Operator",
    companyName: null,
    role: "user",
    isActive: true,
    lastSignedIn: null,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    version: "structr-authenticated-session-v1",
    profile: profile(),
    tenantId,
    permissions: { slugs: ["client:write"], isPlatformAdmin: false },
    ...overrides,
  };
}

function context(overrides: Partial<TrpcContext> = {}): TrpcContext {
  return {
    req: { headers: { authorization: "Bearer e30.e30.synthetic" } },
    res: {},
    authProvider: "supabase",
    user: profile(),
    tenantId,
    authenticatedDataApiSession: session(),
    ...overrides,
  } as unknown as TrpcContext;
}

const open = () => {
  vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
  vi.stubEnv("STRUCTR_INTAKE_FORMATION_ENABLED", "true");
};
const create = (input: unknown = command, ctx: TrpcContext = context()) =>
  appRouter.createCaller(ctx).intake.create(input as never);
const sessionDescriptor = (ctx: TrpcContext = context()) =>
  appRouter.createCaller(ctx).auth.session();

/** No legacy formation, authorization lookup, geocoding or extra audit may run. */
function expectNoLegacyWork(): void {
  expect(io.createForm).not.toHaveBeenCalled();
  expect(io.permission).not.toHaveBeenCalled();
  expect(io.client).not.toHaveBeenCalled();
  expect(io.access).not.toHaveBeenCalled();
  expect(io.address).not.toHaveBeenCalled();
  expect(io.geocode).not.toHaveBeenCalled();
  expect(io.persistGeo).not.toHaveBeenCalled();
  expect(io.audit).not.toHaveBeenCalled();
}

/** Nothing from the transport, the provider body, SQL or the request may surface. */
function expectSanitized(error: unknown): void {
  const trpc = error as { message: string; cause?: unknown };
  expect(typeof trpc.message).toBe("string");
  expect(trpc.message.length).toBeLessThan(200);
  expect(trpc.cause).toBeUndefined();
  for (const leak of [
    "Bearer",
    "e30.",
    actorId,
    tenantId,
    requestId,
    "structr_intake_create_v1",
    "intake_forms",
    "supabase",
    "pgrst",
    "40001",
    "P0001",
    "password",
    "relation",
    "select",
    "insert",
    "fetch failed",
    "at Object.",
  ]) {
    expect(trpc.message.toLowerCase()).not.toContain(leak.toLowerCase());
  }
}

beforeEach(() => {
  for (const spy of Object.values(io)) spy.mockReset();
  io.rpc.mockResolvedValue(wire());
  io.createForm.mockResolvedValue({ id: requestId, projectId });
  io.permission.mockResolvedValue(undefined);
  io.client.mockResolvedValue({ id: otherId });
  io.access.mockResolvedValue({});
  io.address.mockReturnValue({ isValid: true });
  io.geocode.mockResolvedValue({ success: true, geocode: { confidence: "high" }, zoneSnapshot: {} });
  io.persistGeo.mockResolvedValue(undefined);
  io.audit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("IF-1 frozen command bytes", () => {
  it("freezes the real preimage and its fingerprint for the fixture command", () => {
    expect(serializeIntakeFormationPreimage(command, identity)).toBe(FROZEN_PREIMAGE);
    expect(createHash("sha256").update(FROZEN_PREIMAGE, "utf8").digest("hex")).toBe(
      FROZEN_FINGERPRINT,
    );
  });
});

describe("IF-1 authenticated intake.create formation", () => {
  it("is closed by default in the authenticated mode, before any work", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
    await expect(create()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(io.rpc).not.toHaveBeenCalled();
    expectNoLegacyWork();
  });

  it("routes the stable command and protected identity to the named RPC", async () => {
    open();
    const ctx = context();
    await create(command, ctx);
    expect(io.rpc).toHaveBeenCalledTimes(1);
    const [req, sent, sentIdentity] = io.rpc.mock.calls[0];
    expect(req).toBe(ctx.req);
    expect(sent).toEqual(command);
    expect(sentIdentity).toEqual({ actorId, tenantId });
    expect(serializeIntakeFormationPreimage(sent, sentIdentity)).toBe(FROZEN_PREIMAGE);
    expectNoLegacyWork();
  });

  it("returns the decoded current intake with the frozen envelope values", async () => {
    open();
    expect(await create()).toEqual({
      id: requestId,
      tenantId,
      leadId: null,
      projectId,
      status: "draft",
      formData: {
        creationFingerprint: FROZEN_FINGERPRINT,
        serviceType: "repair",
        area: null,
        condition: null,
        notes: null,
      },
      createdAt: new Date("2026-10-09T12:00:00.000Z"),
      updatedAt: new Date("2026-10-09T12:00:00.000Z"),
    });
  });

  it("returns a legitimately evolved replay row without re-forming it", async () => {
    open();
    const raw = wire();
    raw.intake.status = "converted";
    raw.intake.projectId = null;
    raw.intake.formData.notes = "Edited later";
    io.rpc.mockResolvedValue(raw);
    expect(await create()).toMatchObject({
      status: "converted",
      projectId: null,
      formData: { notes: "Edited later" },
    });
    expect(io.rpc).toHaveBeenCalledTimes(1);
    expectNoLegacyWork();
  });

  it("never sends caller-supplied identity fields to the RPC", async () => {
    open();
    await create({ ...command, tenantId: "hostile", userId: "hostile" });
    const [, sent, sentIdentity] = io.rpc.mock.calls[0];
    expect(sent).toEqual(command);
    expect(sentIdentity).toEqual({ actorId, tenantId });
  });

  it("does not retry a conflict inside the router", async () => {
    open();
    io.rpc.mockRejectedValue(new AuthenticatedDataApiError("conflict", "P0001", "INTAKE_FORMATION_CONFLICT"));
    await expect(create()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(io.rpc).toHaveBeenCalledTimes(1);
    expectNoLegacyWork();
  });
});

describe("IF-1 refuses commands this branch does not own", () => {
  it.each([
    ["an existing project target", { projectId, rawPayload: {} }],
    ["an existing client target", { clientId: otherId, rawPayload: {} }],
    ["an existing lead target", { leadId: otherId, rawPayload: {} }],
    ["a bare payload with no formation", { rawPayload: {} }],
  ] as const)("rejects %s before the RPC", async (_name, input) => {
    open();
    await expect(create(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(io.rpc).not.toHaveBeenCalled();
    expectNoLegacyWork();
  });

  it.each([
    ["a formation without the request identifier", { ...command, requestId: undefined }],
    ["a formation combined with an existing project", { ...command, projectId }],
    ["a formation combined with an existing client", { ...command, clientId: otherId }],
    ["a formation combined with an existing lead", { ...command, leadId: otherId }],
    ["a formation without a service type", { ...command, serviceType: undefined }],
    ["a formation without an address", { ...command, newProject: { ...command.newProject, address: undefined } }],
    ["a formation with an invalid customer email", { ...command, newProject: { ...command.newProject, client: { ...command.newProject.client, email: "invalid" } } }],
    ["a formation without an opaque payload", { ...command, rawPayload: undefined }],
  ] as const)("rejects %s before the RPC", async (_name, input) => {
    open();
    await expect(create(input)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(io.rpc).not.toHaveBeenCalled();
    expectNoLegacyWork();
  });
});

describe("IF-1 protected identity is required before the RPC", () => {
  it.each([
    ["no authenticated bootstrap session", { authenticatedDataApiSession: undefined }],
    ["a session for another profile", { authenticatedDataApiSession: session({ profile: profile({ id: otherId }) }) }],
    ["a session for another tenant", { authenticatedDataApiSession: session({ tenantId: otherId }) }],
    ["a session profile bound to another tenant", { authenticatedDataApiSession: session({ profile: profile({ tenantId: otherId }) }) }],
    ["an inactive session profile", { authenticatedDataApiSession: session({ profile: profile({ isActive: false }) }) }],
    ["an inactive current user", { user: profile({ isActive: false }) }],
    ["a current user from another tenant", { user: profile({ tenantId: otherId }) }],
    ["a current user with another identifier", { user: profile({ id: otherId }) }],
    ["a legacy auth provider", { authProvider: "legacy" as const }],
    ["a non-canonical actor identifier", { user: profile({ id: actorId.toUpperCase() }), authenticatedDataApiSession: session({ profile: profile({ id: actorId.toUpperCase() }) }) }],
    ["a nil tenant identifier", { tenantId: "00000000-0000-0000-0000-000000000000" }],
  ] as const)("refuses %s", async (_name, overrides) => {
    open();
    const error = await create(command, context(overrides as Partial<TrpcContext>)).catch(e => e);
    expect(error).toMatchObject({ code: "FORBIDDEN" });
    expectSanitized(error);
    expect(io.rpc).not.toHaveBeenCalled();
    expectNoLegacyWork();
  });

  it("refuses a mismatched resolved tenant before the RPC", async () => {
    open();
    await expect(create(command, context({ tenantId: otherId }))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it("still rejects an anonymous caller and an unresolved tenant", async () => {
    open();
    await expect(create(command, context({ user: null }))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(create(command, context({ tenantId: null }))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(io.rpc).not.toHaveBeenCalled();
    expectNoLegacyWork();
  });
});

describe("IF-1 real decoder rejects an unbound envelope", () => {
  it.each([
    ["a forged actor context", (raw: Wire) => { raw.context.actorId = otherId; }],
    ["a forged tenant context", (raw: Wire) => { raw.context.tenantId = otherId; }],
    ["another intake identifier", (raw: Wire) => { raw.intake.id = otherId; }],
    ["another intake tenant", (raw: Wire) => { raw.intake.tenantId = otherId; }],
    ["a forged creation fingerprint", (raw: Wire) => { raw.intake.formData.creationFingerprint = "f".repeat(64); }],
    ["a missing creation fingerprint", (raw: Wire) => { delete raw.intake.formData.creationFingerprint; }],
    ["an unknown protocol version", (raw: Wire) => { (raw as { version: string }).version = "structr-authenticated-intake-create-v2"; }],
    ["an unexpected envelope key", (raw: Wire) => { (raw as unknown as Record<string, unknown>).extra = true; }],
    ["an unexpected intake column", (raw: Wire) => { (raw.intake as unknown as Record<string, unknown>).deletedAt = null; }],
    ["a missing intake column", (raw: Wire) => { delete (raw.intake as unknown as Record<string, unknown>).status; }],
    ["a non-canonical timestamp", (raw: Wire) => { raw.intake.createdAt = "2026-10-09T12:00:00Z"; }],
  ] as const)("refuses %s as an uncertain result", async (_name, mutate) => {
    open();
    const raw = wire();
    mutate(raw);
    io.rpc.mockResolvedValue(raw);
    const error = await create().catch(e => e);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expectSanitized(error);
    expectNoLegacyWork();
  });

  it("refuses a response that is not plain data", async () => {
    open();
    io.rpc.mockResolvedValue(Object.assign(Object.create({ hostile: true }), wire()));
    await expect(create()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expectNoLegacyWork();
  });

  it.each([[null], [undefined], ["draft"], [7], [[]], [{}]])("refuses the non-envelope response %j", async raw => {
    open();
    io.rpc.mockResolvedValue(raw);
    await expect(create()).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expectNoLegacyWork();
  });
});

describe("IF-1 sanitized error mapping without SQL fallback", () => {
  it.each([
    ["unauthorized", "UNAUTHORIZED"],
    ["forbidden", "FORBIDDEN"],
    ["not_found", "NOT_FOUND"],
    ["invalid_request", "BAD_REQUEST"],
    ["conflict", "CONFLICT"],
    ["unavailable", "INTERNAL_SERVER_ERROR"],
  ] as const)("maps the %s transport failure to %s", async (kind, code) => {
    open();
    io.rpc.mockRejectedValue(new AuthenticatedDataApiError(kind, "42501", "FORBIDDEN"));
    const error = await create().catch(e => e);
    expect(error).toMatchObject({ code });
    expectSanitized(error);
    expectNoLegacyWork();
  });

  it("sanitizes an unexpected failure carrying provider and SQL detail", async () => {
    open();
    io.rpc.mockRejectedValue(
      new Error('PGRST302: insert into "intake_forms" failed; password=hunter2; relation does not exist'),
    );
    const error = await create().catch(e => e);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expectSanitized(error);
    expectNoLegacyWork();
  });

  it("does not promise a rollback for an uncertain result", async () => {
    open();
    io.rpc.mockRejectedValue(new AuthenticatedDataApiError("unavailable"));
    const error = await create().catch(e => e);
    expect(error).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(error.message).not.toMatch(/roll(ed)? ?back|was not created|nothing was saved|no changes/i);
  });
});

describe("IF-1 leaves the existing direct mode untouched", () => {
  it("still forms the intake through the legacy helper and geocodes it", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    vi.stubEnv("STRUCTR_INTAKE_FORMATION_ENABLED", "true");
    expect(await create()).toEqual({ id: requestId, projectId });
    expect(io.createForm).toHaveBeenCalledWith(
      expect.objectContaining({ requestId, newProject: command.newProject, tenantId }),
      actorId,
    );
    expect(io.permission).toHaveBeenCalledWith(actorId, "client", "write");
    expect(io.geocode).toHaveBeenCalledWith(
      tenantId,
      expect.objectContaining({ address: command.newProject.address }),
    );
    expect(io.persistGeo).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, userId: actorId }),
    );
    expect(io.rpc).not.toHaveBeenCalled();
  });

  it("still serves existing-target intakes in direct mode", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    await create({ projectId, rawPayload: {} });
    expect(io.access).toHaveBeenCalledWith(projectId, actorId, "write");
    expect(io.createForm).toHaveBeenCalledTimes(1);
    expect(io.rpc).not.toHaveBeenCalled();
  });
});

describe("IF-1 auth.session presentation descriptor", () => {
  it("reports the open gate for a consistent protected identity only", async () => {
    open();
    const descriptor = await sessionDescriptor();
    expect(descriptor.intakeFormationEnabled).toBe(true);
    expect(descriptor.estimateReadOnly).toBe(true);
  });

  it("exposes a boolean only, with no identity or permission detail", async () => {
    open();
    const descriptor = await sessionDescriptor();
    expect(Object.keys(descriptor).sort()).toEqual([
      "authenticated",
      "estimateReadOnly",
      "intakeFormationEnabled",
      "provider",
      "supabase",
    ]);
    expect(JSON.stringify(descriptor)).not.toContain(actorId);
    expect(JSON.stringify(descriptor)).not.toContain(tenantId);
    expect(JSON.stringify(descriptor)).not.toContain("client:write");
  });

  it("is false while the server gate is closed by default", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
    const descriptor = await sessionDescriptor();
    expect(descriptor.intakeFormationEnabled).toBe(false);
    expect(descriptor.estimateReadOnly).toBe(true);
  });

  it("is false in direct mode even with the flag set", async () => {
    vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
    vi.stubEnv("STRUCTR_INTAKE_FORMATION_ENABLED", "true");
    const descriptor = await sessionDescriptor();
    expect(descriptor.intakeFormationEnabled).toBe(false);
    expect(descriptor.estimateReadOnly).toBe(false);
  });

  it.each([
    ["an anonymous caller", { user: null, authenticatedDataApiSession: undefined }],
    ["a missing bootstrap session", { authenticatedDataApiSession: undefined }],
    ["a session for another profile", { authenticatedDataApiSession: session({ profile: profile({ id: otherId }) }) }],
    ["a session for another tenant", { authenticatedDataApiSession: session({ tenantId: otherId }) }],
    ["an inactive profile", { authenticatedDataApiSession: session({ profile: profile({ isActive: false }) }) }],
    ["an unresolved tenant", { tenantId: null }],
    ["a mismatched resolved tenant", { tenantId: otherId }],
    ["a legacy auth provider", { authProvider: "legacy" as const }],
  ] as const)("is false for %s", async (_name, overrides) => {
    open();
    const descriptor = await sessionDescriptor(context(overrides as Partial<TrpcContext>));
    expect(descriptor.intakeFormationEnabled).toBe(false);
  });

  it("never authorizes the write it describes", async () => {
    open();
    expect((await sessionDescriptor()).intakeFormationEnabled).toBe(true);
    await expect(
      create(command, context({ authenticatedDataApiSession: undefined })),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(io.rpc).not.toHaveBeenCalled();
  });
});
