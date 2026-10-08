import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  callAuthenticatedEstimateDraftRead,
  callAuthenticatedInternalApprovalRecord,
} from "./authenticated-data-api";
const id = "10000000-0000-4000-8000-000000000001";
const token = "Bearer e30.e30.synthetic";
const req = { headers: { authorization: token } };
const fetchMock = vi.fn<typeof fetch>();
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeEach(() => {
  vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
  vi.stubEnv("AUTH_PROVIDER", "supabase");
  vi.stubEnv("TENANT_STRICT", "true");
  vi.stubEnv("SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK", "false");
  vi.stubEnv("SUPABASE_URL", "https://pilot-transport.invalid");
  vi.stubEnv(
    "SUPABASE_PUBLISHABLE_KEY",
    "sb_publishable_synthetic_transport_test"
  );
  for (const name of [
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
    vi.stubEnv(name, undefined);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset().mockImplementation(async () => json({ ok: true }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe.each([
  [
    "detail",
    callAuthenticatedEstimateDraftRead,
    "structr_estimate_draft_read_v1",
  ],
  [
    "record",
    callAuthenticatedInternalApprovalRecord,
    "structr_internal_approval_record_v1",
  ],
] as const)("ADR-002 %s fixed transport", (_name, invoke, path) => {
  it("posts only id and forwards this request's bearer to the fixed function", async () => {
    expect(await invoke(req, { id })).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://pilot-transport.invalid/rest/v1/rpc/${path}`);
    expect(JSON.parse(init!.body as string)).toEqual({ command: { id } });
    expect(init).toMatchObject({
      method: "POST",
      redirect: "error",
      cache: "no-store",
      credentials: "omit",
    });
    expect(new Headers(init?.headers).get("authorization")).toBe(token);
  });
  it.each([
    { id, actorId: id },
    { id, tenantId: id },
    { id, path: "arbitrary" },
    { id: "invalid" },
    {},
  ])("rejects untrusted command %# before transport", async command => {
    await expect(invoke(req, command as any)).rejects.toMatchObject({
      kind: "invalid_request",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["40001", "40P01"])(
    "retries the complete HTTP transaction on %s",
    async code => {
      fetchMock.mockImplementationOnce(async () => json({ code }, 500));
      expect(await invoke(req, { id })).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toBe(fetchMock.mock.calls[1][0]);
      expect(fetchMock.mock.calls[0][1]?.body).toBe(
        fetchMock.mock.calls[1][1]?.body
      );
    }
  );
  it("caps transaction conflicts at three and exposes no database detail", async () => {
    fetchMock.mockImplementation(async () =>
      json({ code: "40001", message: "private driver detail" }, 500)
    );
    const error = await invoke(req, { id }).catch(e => e);
    expect(error.kind).toBe("conflict");
    expect(String(error)).not.toContain("private");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("does not retry network failures or forward their detail", async () => {
    fetchMock.mockRejectedValue(new Error("private token"));
    await expect(invoke(req, { id })).rejects.toMatchObject({
      kind: "unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

it("canonicalizes a valid uppercase general UUID before the fixed RPC", async () => {
  const upper = "A1000000-0000-4000-8000-000000000001";
  expect(await callAuthenticatedEstimateDraftRead(req, { id: upper })).toEqual({
    ok: true,
  });
  expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
    command: { id: upper.toLowerCase() },
  });
});
