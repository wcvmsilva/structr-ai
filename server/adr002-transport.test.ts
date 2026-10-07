import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContext } from "./_core/context";
import { router } from "./_core/trpc";
import { authRouter } from "./auth-router";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";

const tokenA = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJhIn0.c2lnbmF0dXJl";
const tokenB = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJiIn0.c2lnbmF0dXJl";
const uuid = "10000000-0000-4000-8000-000000000001";
const tenant = "20000000-0000-4000-8000-000000000001";
const session = () => ({ version: "structr-authenticated-session-v1", tenantId: tenant, profile: {
  id: uuid, tenantId: tenant, externalOpenId: "30000000-0000-4000-8000-000000000001",
  email: "synthetic@example.invalid", loginMethod: "email", fullName: "Synthetic A1", companyName: null,
  role: "member", isActive: true, lastSignedIn: null,
  createdAt: "2026-10-07T00:00:00.000Z", updatedAt: "2026-10-07T00:00:00.000Z",
}, permissions: { slugs: ["estimates:view"], isPlatformAdmin: false } });
function req(token: unknown = `Bearer ${tokenA}`) { return { headers: { authorization: token } } as CreateExpressContextOptions["req"]; }
function opts(request = req()) { return { req: request, res: {} } as CreateExpressContextOptions; }
function json(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }); }
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
  vi.stubEnv("AUTH_PROVIDER", "supabase"); vi.stubEnv("TENANT_STRICT", "true");
  vi.stubEnv("SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK", "false");
  vi.stubEnv("SUPABASE_URL", "https://pilot-transport.invalid");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_synthetic_transport_test");
  for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRESQL_URL", "DIRECT_URL", "PGHOST", "PGUSER", "PGPASSWORD", "PGSERVICE", "JWT_SECRET", "SUPABASE_JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) vi.stubEnv(name, undefined);
  vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json(session()));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("ADR-002 authenticated bootstrap at the HTTP boundary", () => {
  it("builds the real context from a closed session RPC profile without SQL", async () => {
    const ctx = await createContext(opts());
    expect(ctx.user?.id).toBe(uuid); expect(ctx.tenantId).toBe(tenant);
    expect(ctx.user?.createdAt).toEqual(new Date("2026-10-07T00:00:00.000Z"));
    expect(ctx.authenticatedDataApiSession?.permissions.slugs).toEqual(["estimates:view"]);
    expect(JSON.stringify(ctx.authenticatedDataApiSession)).not.toContain(tokenA);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://pilot-transport.invalid/rest/v1/rpc/structr_authenticated_session_v1");
    expect(init).toMatchObject({ method: "POST", body: "{}", redirect: "error", cache: "no-store", credentials: "omit" });
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${tokenA}`);
    expect(new Headers(init?.headers).get("apikey")).toBe("sb_publishable_synthetic_transport_test");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
  it("uses each concurrent request's bearer without persisting a singleton identity", async () => {
    await Promise.all([createContext(opts(req(`Bearer ${tokenA}`))), createContext(opts(req(`Bearer ${tokenB}`)))]);
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get("authorization")).sort()).toEqual([`Bearer ${tokenA}`, `Bearer ${tokenB}`].sort());
  });
  it("serves auth.me from the authenticated projection with no SQL enrichment", async () => {
    const ctx = await createContext(opts());
    const me = await router({ auth: authRouter }).createCaller(ctx).auth.me();
    expect(me?.id).toBe(uuid); expect(me?.permissions).toEqual(["estimates:view"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, "", "Basic x", "Bearer invalid", `Bearer ${tokenA}, Bearer ${tokenB}`, [`Bearer ${tokenA}`], `Bearer ${tokenA}\r\nsecret`])("rejects malformed or absent bearer before any transport", async authorization => {
    const request = { headers: { authorization, cookie: "legacy=must-not-authenticate" } } as unknown as CreateExpressContextOptions["req"];
    const ctx = await createContext(opts(request));
    expect(ctx.user).toBeNull(); expect(ctx.tenantId).toBeNull(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    (s: any) => { s.profile.tenantId = "40000000-0000-4000-8000-000000000001"; },
    (s: any) => { s.profile.isActive = false; },
    (s: any) => { s.version = "v2"; },
    (s: any) => { s.profile.createdAt = "not-a-date"; },
    (s: any) => { s.profile.externalOpenId = null; },
    (s: any) => { s.permissions.isPlatformAdmin = true; },
    (s: any) => { s.profile.passwordHash = "private-data"; },
    (s: any) => { s.profile.id = "00000000-0000-0000-0000-000000000000"; },
    (s: any) => { s.permissions.slugs.push("estimates:view"); },
    (s: any) => { s.unexpected = "private-data"; },
  ])("fails closed on an invalid session projection %#", async mutate => {
    const data = session(); mutate(data); fetchMock.mockImplementation(async () => json(data));
    const ctx = await createContext(opts()); expect(ctx.user).toBeNull(); expect(ctx.tenantId).toBeNull();
  });
});

describe("ADR-002 fixed review RPC transport", () => {
  async function review(command: unknown = { id: uuid, confirmedCurrencyCode: "USD" }, request = req()) {
    const { callAuthenticatedReview } = await import("./authenticated-data-api");
    return callAuthenticatedReview(request, command as { id: string; confirmedCurrencyCode: "USD" });
  }
  it("posts only the closed command to the existing review RPC and returns raw DTO for its domain decoder", async () => {
    const raw = { version: "structr-authenticated-review-v1", sentinel: "raw-domain-data" };
    fetchMock.mockImplementation(async () => json(raw));
    expect(await review()).toEqual(raw);
    expect(fetchMock.mock.calls[0][0]).toBe("https://pilot-transport.invalid/rest/v1/rpc/structr_internal_approval_review_v1");
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ command: { id: uuid, confirmedCurrencyCode: "USD" } });
  });
  it.each([{ id: uuid, confirmedCurrencyCode: "EUR" }, { id: uuid, confirmedCurrencyCode: "USD", tenantId: tenant }, { id: "not-uuid", confirmedCurrencyCode: "USD" }])("rejects untrusted command fields before HTTP %#", async command => {
    await expect(review(command)).rejects.toMatchObject({ kind: "invalid_request" }); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(["40001", "40P01"])("retries the complete read after %s and succeeds", async code => {
    fetchMock.mockImplementationOnce(async () => json({ code, message: "private driver detail" }, 500)).mockImplementationOnce(async () => json({ ok: true }));
    expect(await review()).toEqual({ ok: true }); expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.body).toEqual(fetchMock.mock.calls[1][1]?.body);
  });
  it("caps transaction retries at three complete RPC calls", async () => {
    fetchMock.mockImplementation(async () => json({ code: "40001", message: "private driver detail" }, 500));
    await expect(review()).rejects.toMatchObject({ kind: "conflict", sqlState: "40001" }); expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it.each([[401, "unauthorized"], [403, "forbidden"], [400, "invalid_request"], [500, "unavailable"]])("sanitizes HTTP %s without retrying or leaking response content", async (status, kind) => {
    fetchMock.mockImplementation(async () => json({ message: "private password and token", detail: tokenA }, status as number));
    const error = await review().catch(e => e); expect(error.kind).toBe(kind); expect(String(error)).not.toContain("private"); expect(JSON.stringify(error)).not.toContain(tokenA); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each(["NOT_FOUND", "FORBIDDEN", "INTERNAL_APPROVAL_INTEGRITY_ERROR", "INTERNAL_APPROVAL_CONTENT_UNRESOLVED", "POLICY_CONTEXT_UNRESOLVED", "INTERNAL_APPROVAL_ALREADY_DECIDED", "HISTORICAL_AUTHORITY_NOT_AVAILABLE"])("preserves only the known exact application error %s", async code => {
    fetchMock.mockImplementation(async () => json({ code: "P0001", message: code, details: "private" }, 400));
    await expect(review()).rejects.toMatchObject({ applicationCode: code });
  });
  it.each([["P0001", "NOT_FOUND private"], ["P0001", "unknown-private-error"], ["XX000", "NOT_FOUND"], ["PGRST500", "NOT_FOUND"]])("does not forward unknown or untrusted SQL messages %#", async (code, message) => {
    fetchMock.mockImplementation(async () => json({ code, message }, 500));
    const error = await review().catch(e => e); expect(error.applicationCode).toBeUndefined(); expect(String(error)).not.toContain(message);
  });
  it("sanitizes a rejected fetch without SQL fallback or retry", async () => {
    fetchMock.mockRejectedValue(new Error(`private ${tokenA}`));
    await expect(review()).rejects.toMatchObject({ kind: "unavailable" }); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed success JSON", async () => {
    fetchMock.mockImplementation(async () => new Response("private-invalid-json", { status: 200 }));
    await expect(review()).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("never follows an HTTP redirect with the bearer", async () => {
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "https://other.invalid" } }));
    await expect(review()).rejects.toMatchObject({ kind: "unavailable" }); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("error");
  });
  it("aborts a stalled request at the finite transport deadline and sanitizes the failure", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    fetchMock.mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException(`private ${tokenA}`, "TimeoutError")), { once: true });
      queueMicrotask(() => controller.abort());
    }));
    try {
      await expect(review()).rejects.toMatchObject({ kind: "unavailable" });
      expect(timeout).toHaveBeenCalledWith(10_000); expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { timeout.mockRestore(); }
  });
  it("rejects oversized provider responses before exposing their contents", async () => {
    fetchMock.mockImplementation(async () => new Response("private", { headers: { "content-length": "16777217" } }));
    await expect(review()).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("rejects a streamed response that exceeds the declared size", async () => {
    fetchMock.mockImplementation(async () => new Response(new Uint8Array(16_777_217), { headers: { "content-length": "2" } }));
    await expect(review()).rejects.toMatchObject({ kind: "unavailable" });
  });
  it("rejects a transport that unexpectedly followed a redirect", async () => {
    fetchMock.mockImplementation(async () => { const response = json({ private: "data" }); Object.defineProperty(response, "redirected", { value: true }); return response; });
    await expect(review()).rejects.toMatchObject({ kind: "unavailable" });
  });
});
