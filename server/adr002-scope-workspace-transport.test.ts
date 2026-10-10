import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAuthenticatedScopeWorkspaceRead } from "./authenticated-data-api";
import { loadAuthenticatedScopeWorkspace } from "./authenticated-scope-workspace-read";
const actorId = "a1000000-0000-4000-8000-000000000001",
  tenantId = "b1000000-0000-4000-8000-000000000001";
const projectId = "c1000000-0000-4000-8000-000000000001",
  intakeFormId = "d1000000-0000-4000-8000-000000000001";
const command = { projectId, intakeFormId },
  token = "Bearer e30.e30.synthetic";
const req = { headers: { authorization: token, cookie: "must-not-forward" } };
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const fetchMock = vi.fn<typeof fetch>();
function envelope() {
  return {
    version: "structr-authenticated-scope-workspace-read-v1",
    context: { actorId, tenantId },
    project: {
      id: projectId,
      tenantId,
      name: "Synthetic",
      projectType: "repair",
      channel: null,
      status: "intake",
      address: null,
      city: null,
      state: null,
      zipCode: null,
      county: null,
      zone: null,
    },
    intake: {
      id: intakeFormId,
      tenantId,
      projectId,
      status: "draft",
      serviceType: null,
      area: null,
      finishLevel: null,
      condition: null,
      channel: null,
      notes: null,
      createdAt: "2026-10-09T12:00:00.000Z",
      updatedAt: "2026-10-09T12:00:00.000Z",
    },
    scopes: { state: "notLoaded" },
    catalog: { state: "notLoaded" },
  };
}
function context(): any {
  const profile = { id: actorId, tenantId, isActive: true };
  return {
    req,
    user: profile,
    tenantId,
    authProvider: "supabase",
    authenticatedDataApiSession: {
      version: "structr-authenticated-session-v1",
      profile: { ...profile },
      tenantId,
    },
  };
}
beforeEach(() => {
  vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
  vi.stubEnv("AUTH_PROVIDER", "supabase");
  vi.stubEnv("TENANT_STRICT", "true");
  vi.stubEnv("SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK", "false");
  vi.stubEnv("SUPABASE_URL", "https://scope-transport.invalid");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic_scope");
  for (const key of [
    "DATABASE_URL",
    "POSTGRES_URL",
    "POSTGRESQL_URL",
    "DIRECT_URL",
    "PGHOST",
    "PGUSER",
    "PGPASSWORD",
    "PGSERVICE",
    "JWT_SECRET",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SECRET_KEY",
  ])
    vi.stubEnv(key, undefined);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(async () => json(envelope()));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("SWR-1 fixed authenticated transport", () => {
  it("loads and decodes only the authorized pair with original bearer and public profiles", async () => {
    const result = await loadAuthenticatedScopeWorkspace(context(), command);
    expect(result.intake.createdAt).toEqual(
      new Date("2026-10-09T12:00:00.000Z")
    );
    expect(result.project.id).toBe(projectId);
    expect(result.catalog).toEqual({ state: "notLoaded" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://scope-transport.invalid/rest/v1/rpc/structr_scope_workspace_read_v1"
    );
    expect(JSON.parse(init!.body as string)).toEqual({ command });
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      credentials: "omit",
      cache: "no-store",
    });
    expect(Object.fromEntries(new Headers(init!.headers))).toEqual({
      authorization: token,
      apikey: "sb_publishable_synthetic_scope",
      "content-type": "application/json",
      accept: "application/json",
      "content-profile": "public",
      "accept-profile": "public",
    });
  });
  it.each([
    { projectId },
    { ...command, actorId },
    { ...command, intakeFormId: intakeFormId.toUpperCase() },
  ])("refuses invalid command before network %#", async input => {
    await expect(
      callAuthenticatedScopeWorkspaceRead(req, input)
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    "missing session",
    "wrong provider",
    "inactive profile",
    "inactive user",
    "foreign user",
    "foreign tenant",
    "wrong version",
  ])("refuses %s before dispatch", async variant => {
    const ctx = context();
    if (variant === "missing session") delete ctx.authenticatedDataApiSession;
    if (variant === "wrong provider") ctx.authProvider = "legacy";
    if (variant === "inactive profile")
      ctx.authenticatedDataApiSession.profile.isActive = false;
    if (variant === "inactive user") ctx.user.isActive = false;
    if (variant === "foreign user") ctx.user.id = projectId;
    if (variant === "foreign tenant")
      ctx.authenticatedDataApiSession.tenantId = projectId;
    if (variant === "wrong version")
      ctx.authenticatedDataApiSession.version = "legacy";
    await expect(
      loadAuthenticatedScopeWorkspace(ctx, command)
    ).rejects.toMatchObject({ kind: "forbidden" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not expose a valid envelope for another pair", async () => {
    fetchMock.mockImplementation(async () =>
      json({
        ...envelope(),
        project: { ...envelope().project, id: intakeFormId },
      })
    );
    await expect(
      loadAuthenticatedScopeWorkspace(context(), command)
    ).rejects.toMatchObject({ kind: "unavailable" });
  });
  it.each(["40001", "40P01"])(
    "retries the whole RPC on %s with identical command and bearer",
    async code => {
      fetchMock.mockImplementationOnce(async () => json({ code }, 500));
      await expect(
        callAuthenticatedScopeWorkspaceRead(req, command)
      ).resolves.toMatchObject({ project: { id: projectId } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1]!.body).toBe(
        fetchMock.mock.calls[1][1]!.body
      );
      expect(
        new Headers(fetchMock.mock.calls[1][1]!.headers).get("authorization")
      ).toBe(token);
    }
  );
  it("caps retry at three and sanitizes database details", async () => {
    fetchMock.mockImplementation(async () =>
      json({ code: "40001", message: "private sql and token" }, 500)
    );
    const error = await callAuthenticatedScopeWorkspaceRead(req, command).catch(
      e => e
    );
    expect(error).toMatchObject({ kind: "conflict", sqlState: "40001" });
    expect(String(error)).not.toContain("private");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each([
    [400, "P0001", "SCOPE_WORKSPACE_INPUT_INVALID", "invalid_request"],
    [400, "P0001", "SCOPE_WORKSPACE_METADATA_INVALID", "unavailable"],
    [403, "42501", "FORBIDDEN", "forbidden"],
    [400, "P0002", "NOT_FOUND", "not_found"],
    [401, "PGRST301", "private token", "unauthorized"],
    [409, "23505", "private row", "unavailable"],
  ])(
    "maps %s/%s/%s safely without retry",
    async (status, code, message, kind) => {
      fetchMock.mockImplementation(async () =>
        json({ code, message, details: "secret" }, status)
      );
      const error = await callAuthenticatedScopeWorkspaceRead(
        req,
        command
      ).catch(e => e);
      expect(error.kind).toBe(kind);
      expect(String(error)).not.toMatch(/secret|private/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );
  it.each([
    "redirect",
    "network",
    "malformed JSON",
    "declared oversize",
    "actual oversize",
    "invalid UTF-8",
  ])("refuses %s without retry/fallback", async failure => {
    fetchMock.mockImplementation(async () => {
      if (failure === "network") throw new Error("private transport detail");
      if (failure === "redirect")
        return new Response(null, {
          status: 302,
          headers: { location: "https://other.invalid" },
        });
      if (failure === "malformed JSON") return new Response("{not json");
      if (failure === "declared oversize")
        return new Response("{}", { headers: { "content-length": "1048577" } });
      if (failure === "actual oversize")
        return new Response('"' + "x".repeat(1048576) + '"');
      return new Response(new Uint8Array([0x22, 0xc3, 0x28, 0x22]));
    });
    await expect(
      callAuthenticatedScopeWorkspaceRead(req, command)
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("refuses a malformed bearer before fetch", async () => {
    await expect(
      callAuthenticatedScopeWorkspaceRead(
        { headers: { authorization: "Bearer invalid" } },
        command
      )
    ).rejects.toMatchObject({ kind: "unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses the existing ten-second abort signal", async () => {
    const signalSpy = vi.spyOn(AbortSignal, "timeout");
    try {
      await callAuthenticatedScopeWorkspaceRead(req, command);
      expect(signalSpy).toHaveBeenCalledWith(10000);
    } finally {
      signalSpy.mockRestore();
    }
  });
  it("never follows a fetch response marked redirected", async () => {
    fetchMock.mockImplementation(async () => {
      const r = json(envelope());
      Object.defineProperty(r, "redirected", { value: true });
      return r;
    });
    await expect(
      callAuthenticatedScopeWorkspaceRead(req, command)
    ).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
