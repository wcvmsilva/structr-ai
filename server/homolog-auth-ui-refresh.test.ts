/** Real hook, QueryClient and tRPC transport; external Auth/HTTP are controlled.
 * This proves local recovery ordering, not the cause of any hosted incident. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";

const harness = vi.hoisted(() => ({ client: null as any, tree: null as any }));
vi.mock("../client/src/lib/supabase", () => ({
  getSupabaseClient: () => harness.client,
  isSupabaseConfigured: () => true,
  SUPABASE_STORAGE_KEY: "structr-supabase-auth",
}));
vi.mock("../client/src/App", () => ({ default: () => null }));
vi.mock("react-dom/client", () => ({
  createRoot: () => ({
    render: (tree: unknown) => {
      harness.tree = tree;
    },
  }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
function session(id = "A1", token = `old-${id}`, ttl = 3600): Session {
  return {
    access_token: token,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    expires_in: ttl,
    expires_at: Math.floor(Date.now() / 1000) + ttl,
    user: {
      id,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-10-08T00:00:00Z",
    },
  };
}
const profile = {
  id: "profile-A1",
  externalOpenId: "A1",
  tenantId: "tenant-A",
  permissions: [],
};
let current: Session | null;
let notify: (event: string, value: Session | null) => void;
let httpResult: unknown;
let requests: Array<{ path: string; authorization: string | null }>;
const cleanup: Array<() => void> = [];
function emit(event: string, value: Session | null) {
  current = value;
  notify(event, value);
}
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_AUTH_PROVIDER", "supabase");
  current = session();
  httpResult = profile;
  requests = [];
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  });
  vi.stubGlobal("document", { getElementById: () => ({}) });
  harness.client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: current },
        error: null,
      })),
      onAuthStateChange: (listener: typeof notify) => {
        notify = listener;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      refreshSession: vi.fn(async () => {
        const renewed = session("A1", "fresh-A1", 600);
        emit("TOKEN_REFRESHED", renewed);
        return { data: { session: renewed }, error: null };
      }),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), "https://app.example.test");
      requests.push({
        path: url.pathname,
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(
        JSON.stringify([{ result: { data: { json: httpResult } } }]),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    })
  );
});
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderAuth(cached: unknown = null) {
  await import("../client/src/main");
  const token = await import("../client/src/lib/auth-token");
  cleanup.push(await token.initSupabaseAuthBridge());
  const { client, queryClient } = harness.tree.props as {
    client: any;
    queryClient: QueryClient;
  };
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { QueryClientProvider, QueryObserver } = await import(
    "@tanstack/react-query"
  );
  const { getQueryKey } = await import("@trpc/react-query");
  const { trpc } = await import("../client/src/lib/trpc");
  const { useAuth } = await import("../client/src/_core/hooks/useAuth");
  const meKey = getQueryKey(trpc.auth.me, undefined, "query");
  if (cached !== "uncached") queryClient.setQueryData(meKey, cached);
  queryClient.setQueryData(["project", "private-A1"], { owner: "A1" });
  let auth!: ReturnType<typeof useAuth>;
  function Probe() {
    auth = useAuth();
    return null;
  }
  const render = () =>
    renderToStaticMarkup(
      createElement(
        trpc.Provider,
        { client, queryClient },
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(Probe)
        )
      )
    );
  render();
  // SSR does not subscribe hooks; this real observer gives auth.me an active
  // lifecycle so a refresh event must perform the actual HTTP revalidation.
  const observe = () => {
    const observer = new QueryObserver(queryClient, {
      queryKey: meKey,
      queryFn: () => client.auth.me.query(),
      refetchOnMount: false,
      retry: false,
    });
    cleanup.push(observer.subscribe(() => {}));
  };
  cleanup.push(() => queryClient.clear());
  return { auth, token, queryClient, meKey, observe, render, read: () => auth };
}

describe("homolog UI: explicit retry and same-subject refresh recovery", () => {
  it("Try again renews a still-fresh old token once before asking for the profile", async () => {
    const page = await renderAuth();
    const generation = page.token.getAuthSessionSnapshot().generation;
    const result = await page.auth.refresh();
    expect(harness.client.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(requests).toEqual([
      { path: "/api/trpc/auth.me", authorization: "Bearer fresh-A1" },
    ]);
    expect(result).toEqual({ ok: true });
    expect(page.queryClient.getQueryData(page.meKey)).toEqual(profile);
    expect(page.token.getAuthSessionSnapshot().generation).toBe(generation);
    expect(page.queryClient.getQueryData(["project", "private-A1"])).toEqual({
      owner: "A1",
    });
  });

  it("shares simultaneous retries while the provider renewal is pending", async () => {
    const page = await renderAuth();
    const renewal = deferred<any>();
    harness.client.auth.refreshSession.mockReturnValue(renewal.promise);
    const first = page.auth.refresh();
    const second = page.auth.refresh();
    await vi.waitFor(() =>
      expect(harness.client.auth.refreshSession).toHaveBeenCalledTimes(1)
    );
    renewal.resolve({
      data: { session: session("A1", "fresh-A1", 600) },
      error: null,
    });
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
    expect(requests).toHaveLength(1);
  });

  it("reports renewal failure without requesting a profile with the refused token", async () => {
    const page = await renderAuth();
    harness.client.auth.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: "network failed" },
    });
    const result = await page.auth.refresh();
    expect(result).toEqual({
      ok: false,
      message:
        "Cannot refresh your session. Check your connection and try again, or sign out and sign in again.",
    });
    expect(requests).toEqual([]);
    expect(page.token.getAuthSessionSnapshot().error).toBe(
      "message" in result ? result.message : undefined
    );
  });

  it("does not report success when the server still refuses the renewed session", async () => {
    const page = await renderAuth();
    httpResult = null;
    expect(await page.auth.refresh()).toEqual({
      ok: false,
      message:
        "Your session was refreshed, but account access is still unavailable. Try again or contact your administrator.",
    });
    expect(requests[0]?.authorization).toBe("Bearer fresh-A1");
    expect(page.queryClient.getQueryData(page.meKey)).toBeNull();
  });

  it.each(["logout", "identity switch"])(
    "a delayed retry cannot undo %s or query as the new identity",
    async transition => {
      const page = await renderAuth();
      const renewal = deferred<any>();
      harness.client.auth.refreshSession.mockReturnValue(renewal.promise);
      const retry = page.auth.refresh();
      await vi.waitFor(() =>
        expect(harness.client.auth.refreshSession).toHaveBeenCalledTimes(1)
      );
      if (transition === "logout") page.token.clearAccessToken();
      else emit("SIGNED_IN", session("B1"));
      renewal.resolve({
        data: { session: session("A1", "late-A1", 600) },
        error: null,
      });
      expect(await retry).toEqual({
        ok: false,
        message: "Session changed. Please sign in again.",
      });
      expect(requests).toEqual([]);
      expect(page.token.getAccessToken()).toBe(
        transition === "logout" ? null : "old-B1"
      );
    }
  );

  it("a provider refresh revalidates only auth.me and preserves same-account business data", async () => {
    const page = await renderAuth();
    page.observe();
    const generation = page.token.getAuthSessionSnapshot().generation;
    emit("TOKEN_REFRESHED", session("A1", "fresh-A1", 600));
    await vi.waitFor(() =>
      expect(page.queryClient.getQueryData(page.meKey)).toEqual(profile)
    );
    expect(requests).toEqual([
      { path: "/api/trpc/auth.me", authorization: "Bearer fresh-A1" },
    ]);
    expect(page.token.getAuthSessionSnapshot().generation).toBe(generation);
    expect(page.queryClient.getQueryData(["project", "private-A1"])).toEqual({
      owner: "A1",
    });
  });

  it("a delayed null profile result from before renewal cannot overwrite the renewed profile", async () => {
    const page = await renderAuth();
    page.observe();
    const old = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => old.promise);
    const earlier = page.queryClient.refetchQueries({
      queryKey: page.meKey,
      exact: true,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    emit("TOKEN_REFRESHED", session("A1", "fresh-A1", 600));
    await vi.waitFor(() =>
      expect(page.queryClient.getQueryData(page.meKey)).toEqual(profile)
    );
    old.resolve(
      new Response(JSON.stringify([{ result: { data: { json: null } } }]), {
        headers: { "content-type": "application/json" },
      })
    );
    await earlier;
    expect(page.queryClient.getQueryData(page.meKey)).toEqual(profile);
  });

  it("Try again replaces an already-pending profile read made with the old bearer", async () => {
    const page = await renderAuth();
    page.observe();
    const old = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => old.promise);
    const earlier = page.queryClient.refetchQueries({
      queryKey: page.meKey,
      exact: true,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const retry = page.auth.refresh();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(await retry).toEqual({ ok: true });
    old.resolve(
      new Response(JSON.stringify([{ result: { data: { json: null } } }]), {
        headers: { "content-type": "application/json" },
      })
    );
    await earlier;
    expect(page.queryClient.getQueryData(page.meKey)).toEqual(profile);
    expect(requests[0]?.authorization).toBe("Bearer fresh-A1");
  });

  it("renews an initial pending auth.me even before there has ever been cached data", async () => {
    const page = await renderAuth("uncached");
    const old = deferred<Response>();
    vi.mocked(fetch).mockImplementationOnce(() => old.promise);
    page.observe();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    emit("TOKEN_REFRESHED", session("A1", "fresh-A1", 600));
    await vi.waitFor(() =>
      expect(page.queryClient.getQueryData(page.meKey)).toEqual(profile)
    );
    old.resolve(
      new Response(JSON.stringify([{ result: { data: { json: null } } }]), {
        headers: { "content-type": "application/json" },
      })
    );
    await Promise.resolve();
    expect(page.queryClient.getQueryData(page.meKey)).toEqual(profile);
  });

  it("a stale provider callback during a forced refresh cannot switch back from B to A", async () => {
    const page = await renderAuth();
    const renewal = deferred<any>();
    harness.client.auth.refreshSession.mockReturnValue(renewal.promise);
    const retry = page.auth.refresh();
    await vi.waitFor(() =>
      expect(harness.client.auth.refreshSession).toHaveBeenCalledTimes(1)
    );
    emit("SIGNED_IN", session("B1"));
    emit("TOKEN_REFRESHED", session("A1", "late-A1", 600));
    renewal.resolve({
      data: { session: session("A1", "late-A1", 600) },
      error: null,
    });
    expect(await retry).toEqual({
      ok: false,
      message: "Session changed. Please sign in again.",
    });
    expect(page.token.getAccessToken()).toBe("old-B1");
    expect(requests).toEqual([]);
  });

  it("a thrown provider error returns a fixed safe message without raw error details", async () => {
    const page = await renderAuth();
    harness.client.auth.refreshSession.mockRejectedValue(
      new Error("provider-detail-with-secret-sentinel")
    );
    const result = await page.auth.refresh();
    expect(result).toEqual({
      ok: false,
      message:
        "Cannot refresh your session. Check your connection and try again, or sign out and sign in again.",
    });
    expect(
      JSON.stringify(page.token.getAuthSessionSnapshot().error)
    ).not.toContain("secret-sentinel");
    expect(requests).toEqual([]);
  });

  it("a late provider refresh after local logout neither restores identity nor revalidates auth.me", async () => {
    const page = await renderAuth();
    page.observe();
    page.token.clearAccessToken();
    emit("TOKEN_REFRESHED", session("A1", "late-A1", 600));
    await Promise.resolve();
    expect(page.token.getAccessToken()).toBeNull();
    expect(requests).toEqual([]);
    expect(page.queryClient.getQueryData(page.meKey)).toBeUndefined();
  });

  it("legacy retry only refetches its cookie profile without invoking Supabase", async () => {
    vi.stubEnv("VITE_AUTH_PROVIDER", "legacy");
    const page = await renderAuth();
    expect(await page.auth.refresh()).toEqual({ ok: true });
    expect(harness.client.auth.refreshSession).not.toHaveBeenCalled();
    expect(requests).toEqual([
      { path: "/api/trpc/auth.me", authorization: null },
    ]);
  });
});
