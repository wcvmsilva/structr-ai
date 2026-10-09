import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callAuthenticatedIntakeCreate } from "./authenticated-data-api";
import { serializeIntakeFormationPreimage } from "../shared/intake-formation-engine";
const identity = {
  actorId: "a1000000-0000-4000-8000-000000000001",
  tenantId: "b1000000-0000-4000-8000-000000000001",
};
const input = {
  requestId: "C1000000-0000-4000-8000-000000000001",
  newProject: {
    name: "Synthetic project",
    projectType: "repair",
    client: { firstName: "Test", lastName: "Operator" },
    address: "1 Synthetic Lane",
  },
  serviceType: "repair",
  rawPayload: {},
};
const req = { headers: { authorization: "Bearer e30.e30.synthetic" } };
const fetchMock = vi.fn<typeof fetch>();
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
const invoke = (
  command: unknown = input,
  context: unknown = identity,
  request = req
) => callAuthenticatedIntakeCreate(request, command, context);
beforeEach(() => {
  vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
  vi.stubEnv("AUTH_PROVIDER", "supabase");
  vi.stubEnv("TENANT_STRICT", "true");
  vi.stubEnv("SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK", "false");
  vi.stubEnv("SUPABASE_URL", "https://formation-transport.invalid");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic");
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
  fetchMock
    .mockReset()
    .mockImplementation(async () => json({ candidate: true }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("candidate intake fixed transport", () => {
  it("posts exact preimage to the fixed function using only the request bearer/public key", async () => {
    expect(await invoke()).toEqual({ candidate: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://formation-transport.invalid/rest/v1/rpc/structr_intake_create_v1"
    );
    expect(JSON.parse(init!.body as string)).toEqual({
      preimage: serializeIntakeFormationPreimage(input, identity),
    });
    expect(init).toMatchObject({
      method: "POST",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    expect(new Headers(init!.headers).get("authorization")).toBe(
      req.headers.authorization
    );
    expect(new Headers(init!.headers).get("apikey")).toBe(
      "sb_publishable_synthetic"
    );
  });
  it.each([
    {},
    { ...input, requestId: "bad" },
    { ...input, newProject: undefined },
    { ...input, notes: "\u0000" },
  ])("rejects invalid input before fetch %#", async command => {
    await expect(invoke(command)).rejects.toMatchObject({
      kind: "invalid_request",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects unresolved identity before fetch", async () => {
    await expect(
      invoke(input, { ...identity, tenantId: null })
    ).rejects.toMatchObject({ kind: "invalid_request" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects malformed bearer before fetch", async () => {
    await expect(
      invoke(input, identity, {
        headers: { authorization: "Bearer not-token" },
      })
    ).rejects.toMatchObject({ kind: "unauthorized" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["40001", "40P01"])(
    "retries whole request with identical bytes on %s",
    async code => {
      fetchMock.mockImplementationOnce(async () => json({ code }, 500));
      expect(await invoke()).toEqual({ candidate: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][1]!.body).toBe(
        fetchMock.mock.calls[1][1]!.body
      );
    }
  );
  it("caps serialization retries at three", async () => {
    fetchMock.mockImplementation(async () =>
      json({ code: "40001", message: "private details" }, 500)
    );
    await expect(invoke()).rejects.toMatchObject({
      kind: "conflict",
      sqlState: "40001",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each([
    ["INTAKE_FORMATION_INPUT_INVALID", "invalid_request"],
    ["INTAKE_FORMATION_CONFLICT", "conflict"],
    ["INTAKE_FORMATION_INTEGRITY_VIOLATION", "unavailable"],
    ["FORBIDDEN", "forbidden"],
  ])(
    "classifies %s without retry or provider details",
    async (message, kind) => {
      fetchMock.mockImplementation(async () =>
        json({ code: "P0001", message, details: "secret detail" }, 400)
      );
      const error = await invoke().catch(e => e);
      expect(error).toMatchObject({ kind, applicationCode: message });
      expect(String(error)).not.toContain("secret");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );
  it.each(["23505", "23503", "57014"])(
    "never treats generic %s as safely retryable",
    async code => {
      fetchMock.mockImplementation(async () =>
        json({ code, message: "private row" }, 409)
      );
      const error = await invoke().catch(e => e);
      expect(error.kind).toBe("unavailable");
      expect(String(error)).not.toContain("private");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );
  it("does not retry ambiguous network failure after an unknown commit", async () => {
    fetchMock.mockRejectedValue(new Error("private network detail"));
    await expect(invoke()).rejects.toMatchObject({ kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("checks the same token again on retry rather than treating first acceptance as authority", async () => {
    fetchMock
      .mockImplementationOnce(async () => json({ code: "40001" }, 500))
      .mockImplementationOnce(async () =>
        json({ code: "P0001", message: "FORBIDDEN" }, 403)
      );
    await expect(invoke()).rejects.toMatchObject({ kind: "forbidden" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      new Headers(fetchMock.mock.calls[1][1]!.headers).get("authorization")
    ).toBe(req.headers.authorization);
  });
});
