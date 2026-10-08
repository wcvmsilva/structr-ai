/** Browser-session boundary only: real QueryClient/tRPC; the external Auth and HTTP
 * transports are controlled. This is not a hosted Auth or browser acceptance proof. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";

const harness = vi.hoisted(() => ({
  client: null as any,
  tree: null as any,
}));
vi.mock("../client/src/lib/supabase", () => ({
  getSupabaseClient: () => harness.client,
  requireSupabaseClient: () => harness.client,
  isSupabaseConfigured: () => Boolean(harness.client),
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
function session(
  id: string,
  token = `token-${id}`,
  expires = Date.now() / 1000 + 3600
): Session {
  return {
    access_token: token,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expires,
    user: {
      id,
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-10-08T00:00:00Z",
    },
  };
}
let current: Session | null;
let subscribers: Set<(event: string, value: Session | null) => void>;
function emit(event: string, value: Session | null) {
  current = value;
  for (const listener of subscribers) listener(event, value);
}
function rpcResponse(value: unknown) {
  return new Response(JSON.stringify([{ result: { data: { json: value } } }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
async function mountedTransport(expectAuthSubscription = true) {
  await import("../client/src/main");
  if (expectAuthSubscription)
    await vi.waitFor(() => expect(subscribers.size).toBeGreaterThan(0));
  // Initial hydration must settle before this test dispatches application work.
  await Promise.resolve();
  return harness.tree.props as { client: any; queryClient: QueryClient };
}

beforeEach(() => {
  vi.resetModules();
  current = session("A1");
  subscribers = new Set();
  harness.tree = null;
  harness.client = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: current },
        error: null,
      })),
      onAuthStateChange: vi.fn(
        (listener: (event: string, value: Session | null) => void) => {
          subscribers.add(listener);
          return {
            data: {
              subscription: { unsubscribe: () => subscribers.delete(listener) },
            },
          };
        }
      ),
      signInWithPassword: vi.fn(async () => ({
        data: { session: current },
        error: null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
  vi.stubGlobal("document", { getElementById: () => ({}) });
  vi.stubGlobal("localStorage", {
    removeItem: vi.fn(),
    setItem: vi.fn(),
    getItem: () => null,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => rpcResponse({ owner: "A1" }))
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("homolog UI: shared Auth hydration and token ordering", () => {
  it("a newer Auth event wins over a late persisted-session read", async () => {
    const hydration = deferred<any>();
    harness.client.auth.getSession.mockReturnValue(hydration.promise);
    const token = await import("../client/src/lib/auth-token");
    const ready = token.initSupabaseAuthBridge();
    emit("SIGNED_IN", session("B1"));
    hydration.resolve({ data: { session: session("A1") }, error: null });
    await ready;
    expect(await token.buildAuthHeaders()).toEqual({
      Authorization: "Bearer token-B1",
    });
  });

  it("repeated bridge initialization keeps one Auth subscription", async () => {
    const token = await import("../client/src/lib/auth-token");
    await Promise.all([
      token.initSupabaseAuthBridge(),
      token.initSupabaseAuthBridge(),
    ]);
    expect(subscribers.size).toBe(1);
  });

  it("a stale token refresh cannot overwrite a newer account", async () => {
    current = session("A1", "old-A1", Date.now() / 1000 - 1);
    const token = await import("../client/src/lib/auth-token");
    await token.initSupabaseAuthBridge();
    const read = deferred<any>();
    harness.client.auth.getSession.mockReturnValue(read.promise);
    const headers = token.buildAuthHeaders();
    await vi.waitFor(() =>
      expect(harness.client.auth.getSession).toHaveBeenCalledTimes(2)
    );
    emit("SIGNED_IN", session("B1"));
    read.resolve({
      data: { session: session("A1", "refreshed-A1") },
      error: null,
    });
    await headers;
    expect(token.getAccessToken()).toBe("token-B1");
  });

  it("clearing the local session cannot rehydrate the signed-out token", async () => {
    const token = await import("../client/src/lib/auth-token");
    await token.initSupabaseAuthBridge();
    token.clearAccessToken();
    expect(await token.buildAuthHeaders()).toEqual({});
  });

  it("shared hook subscriptions can mount/unmount without stopping the transport bridge", async () => {
    const token = await import("../client/src/lib/auth-token");
    await token.initSupabaseAuthBridge();
    const stopFirst = token.subscribeAuthSession(() => {});
    const stopSecond = token.subscribeAuthSession(() => {});
    stopFirst();
    stopSecond();
    const stopRemount = token.subscribeAuthSession(() => {});
    emit("TOKEN_REFRESHED", session("A1", "new-A1"));
    expect(await token.buildAuthHeaders()).toEqual({
      Authorization: "Bearer new-A1",
    });
    expect(subscribers.size).toBe(1);
    stopRemount();
  });

  it("an SDK revocation still carries the old bearer after the UI clears its local session", async () => {
    // Real Supabase SDK, controlled HTTP/storage: deleting provider storage before
    // signOut would silently skip the revocation request.
    const { createClient } = await import("@supabase/supabase-js");
    const storage = new Map([
      ["structr-supabase-auth", JSON.stringify(current)],
    ]);
    const requests: string[] = [];
    const sdk = createClient(
      "https://auth.example.test",
      "sb_publishable_synthetic",
      {
        auth: {
          storageKey: "structr-supabase-auth",
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => {
              storage.set(key, value);
            },
            removeItem: key => {
              storage.delete(key);
            },
          },
        },
        global: {
          fetch: async (_url, options) => {
            requests.push(
              new Headers(options?.headers).get("Authorization") ?? ""
            );
            return new Response("{}", {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          },
        },
      }
    );
    harness.client = sdk;
    vi.stubGlobal("localStorage", {
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    const token = await import("../client/src/lib/auth-token");
    const stop = await token.initSupabaseAuthBridge();
    const logout = token.signOutSupabaseSession();
    expect(token.getAccessToken()).toBeNull();
    await logout;
    expect(requests).toEqual(["Bearer token-A1"]);
    expect(storage.has("structr-supabase-auth")).toBe(false);
    stop();
  });

  it("a failed provider logout does not restore local access on a subsequent token request", async () => {
    const token = await import("../client/src/lib/auth-token");
    await token.initSupabaseAuthBridge();
    harness.client.auth.signOut.mockRejectedValue(
      new Error("network unavailable")
    );
    await token.signOutSupabaseSession();
    emit("TOKEN_REFRESHED", session("A1", "late-refresh-A1"));
    expect(await token.buildAuthHeaders()).toEqual({});
    expect(token.getAuthSessionSnapshot().session).toBeNull();
  });

  it("waits for an earlier logout before creating the next session", async () => {
    const token = await import("../client/src/lib/auth-token");
    await token.initSupabaseAuthBridge();
    const revocation = deferred<any>();
    harness.client.auth.signOut.mockReturnValue(revocation.promise);
    const next = session("B1");
    harness.client.auth.signInWithPassword.mockResolvedValue({
      data: { session: next, user: next.user },
      error: null,
    });
    const logout = token.signOutSupabaseSession();
    const login = token.signInSupabaseSession("b@example.test", "synthetic");
    await Promise.resolve();
    await Promise.resolve();
    expect(harness.client.auth.signInWithPassword).not.toHaveBeenCalled();
    revocation.resolve({ error: null });
    await logout;
    expect(await login).toEqual({ ok: true });
    expect(await token.buildAuthHeaders()).toEqual({
      Authorization: "Bearer token-B1",
    });
  });

  it("does not restore the signed-out account after reload while provider revocation is pending", async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const storage = new Map([
      ["structr-supabase-auth", JSON.stringify(current)],
    ]);
    const revocation = deferred<Response>();
    let revocationStarted = false;
    const makeSdk = () =>
      createClient("https://auth.example.test", "sb_publishable_synthetic", {
        auth: {
          storageKey: "structr-supabase-auth",
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storage: {
            getItem: key => storage.get(key) ?? null,
            setItem: (key, value) => {
              storage.set(key, value);
            },
            removeItem: key => {
              storage.delete(key);
            },
          },
        },
        global: {
          fetch: async () => {
            revocationStarted = true;
            return revocation.promise;
          },
        },
      });
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    harness.client = makeSdk();
    const firstPage = await import("../client/src/lib/auth-token");
    const stopFirst = await firstPage.initSupabaseAuthBridge();
    const logout = firstPage.signOutSupabaseSession();
    let stopReloaded: (() => void) | undefined;
    try {
      await vi.waitFor(() => expect(revocationStarted).toBe(true));
      expect(firstPage.getAccessToken()).toBeNull();
      // A browser reload loses module memory but keeps provider localStorage.
      vi.resetModules();
      harness.client = makeSdk();
      const reloadedPage = await import("../client/src/lib/auth-token");
      stopReloaded = await reloadedPage.initSupabaseAuthBridge();
      expect(await reloadedPage.buildAuthHeaders()).toEqual({});
      expect(reloadedPage.getAuthSessionSnapshot().session).toBeNull();
    } finally {
      revocation.resolve(
        new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
      await logout;
      stopFirst();
      stopReloaded?.();
    }
  });

  it("keeps a persisted logout closed after bad credentials and unlocks only after explicit successful login", async () => {
    const storage = new Map([["structr-supabase-logout-intent", "1"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
    const token = await import("../client/src/lib/auth-token");
    await token.initSupabaseAuthBridge();
    harness.client.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null, user: null },
      error: { message: "Invalid login credentials" },
    });
    expect(
      await token.signInSupabaseSession("operator@example.test", "wrong")
    ).toEqual({ ok: false, message: "Invalid email or password." });
    expect(await token.buildAuthHeaders()).toEqual({});
    expect(storage.get("structr-supabase-logout-intent")).toBe("1");
    const next = session("B1");
    harness.client.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: next, user: next.user },
      error: null,
    });
    expect(
      await token.signInSupabaseSession("operator@example.test", "correct")
    ).toEqual({ ok: true });
    expect(await token.buildAuthHeaders()).toEqual({
      Authorization: "Bearer token-B1",
    });
    expect(storage.has("structr-supabase-logout-intent")).toBe(false);
  });
});

describe("homolog UI: legacy rollback with Supabase configuration still present", () => {
  it.each(["SIGNED_IN", "SIGNED_OUT"])(
    "ignores the unrelated Supabase %s event without clearing legacy data or aborting requests",
    async event => {
      vi.stubEnv("VITE_AUTH_PROVIDER", "legacy");
      const { client, queryClient } = await mountedTransport(false);
      queryClient.setQueryData(["legacy", "project"], {
        title: "Cookie operator project",
      });
      const response = deferred<Response>();
      vi.mocked(fetch).mockReturnValue(response.promise);
      const request = client.estimate.getById
        .query({ id: "legacy-draft" })
        .catch((error: Error) => ({ error: error.message }));
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      emit(event, event === "SIGNED_IN" ? session("B1") : null);
      response.resolve(rpcResponse({ title: "Cookie operator project" }));
      expect(await request).toEqual({ title: "Cookie operator project" });
      expect(queryClient.getQueryData(["legacy", "project"])).toEqual({
        title: "Cookie operator project",
      });
      expect(
        new Headers(vi.mocked(fetch).mock.calls[0][1]?.headers).get(
          "Authorization"
        )
      ).toBeNull();
    }
  );
});

describe("homolog UI: account boundary in the application transport", () => {
  it.each(["provider event", "storage event"])(
    "clears the already-open tab immediately when another tab signs out (%s)",
    async signal => {
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
      const browserEvents = new EventTarget();
      vi.stubGlobal("window", browserEvents);
      const { queryClient } = await mountedTransport();
      const token = await import("../client/src/lib/auth-token");
      queryClient.setQueryData(["estimate", "A"], { title: "A confidential" });
      // Shared storage changed in a different document; do not make an HTTP call
      // in this tab to discover it. Both normal browser signals must end its view.
      storage.set("structr-supabase-logout-intent", "1");
      if (signal === "provider event") emit("SIGNED_OUT", null);
      else
        browserEvents.dispatchEvent(
          Object.assign(new Event("storage"), {
            key: "structr-supabase-logout-intent",
            newValue: "1",
          })
        );
      expect(token.getAuthSessionSnapshot().session).toBeNull();
      expect(queryClient.getQueryData(["estimate", "A"])).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    }
  );

  it("removes both business queries and mutation records when the account changes", async () => {
    const { queryClient } = await mountedTransport();
    queryClient.setQueryData(["estimate", "A"], {
      title: "Tenant A confidential",
    });
    await queryClient
      .getMutationCache()
      .build(queryClient, { mutationFn: async () => "A result" })
      .execute(undefined);
    emit("SIGNED_IN", session("B1"));
    expect(queryClient.getQueryData(["estimate", "A"])).toBeUndefined();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it("removes cached business data on a sign-out event", async () => {
    const { queryClient } = await mountedTransport();
    queryClient.setQueryData(["estimate", "A"], {
      title: "Tenant A confidential",
    });
    emit("SIGNED_OUT", null);
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("keeps the current account's cache during a token refresh", async () => {
    const { queryClient } = await mountedTransport();
    queryClient.setQueryData(["estimate", "A"], { title: "A current" });
    emit("TOKEN_REFRESHED", session("A1", "refreshed-A1"));
    expect(queryClient.getQueryData(["estimate", "A"])).toEqual({
      title: "A current",
    });
  });

  it("cancels pending query work and does not repopulate cache with its late result", async () => {
    const { queryClient } = await mountedTransport();
    const response = deferred<string>();
    let signal: AbortSignal | undefined;
    const result = queryClient
      .fetchQuery({
        queryKey: ["estimate", "pending-A"],
        queryFn: context => {
          signal = context.signal;
          return response.promise;
        },
      })
      .catch(() => undefined);
    emit("SIGNED_IN", session("A2"));
    response.resolve("private A1 result");
    await result;
    expect(signal?.aborted).toBe(true);
    expect(queryClient.getQueryData(["estimate", "pending-A"])).toBeUndefined();
  });

  it.each(["query", "mutate"] as const)(
    "discards an old account's delayed %s response",
    async method => {
      const { client } = await mountedTransport();
      const response = deferred<Response>();
      vi.mocked(fetch).mockReturnValue(response.promise);
      const request =
        method === "query"
          ? client.estimate.getById.query({
              id: "a1111111-1111-4111-8111-111111111111",
            })
          : client.estimate.approveEstimate.mutate({
              id: "a1111111-1111-4111-8111-111111111111",
              requestId: "b1111111-1111-4111-8111-111111111111",
              expectedDraftVersion: 1,
              expectedContentHash: "a".repeat(64),
              expectedPolicyHash: "b".repeat(64),
              confirmedCurrencyCode: "USD",
              reason: "Synthetic UI session boundary fixture",
            });
      const outcome = request.then(
        (value: unknown) => ({ value }),
        (error: Error) => ({ error: error.message })
      );
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
      emit("SIGNED_IN", session("B1"));
      response.resolve(rpcResponse({ confidential: "A-only" }));
      expect(await outcome).toEqual({
        error: "Session changed. Please try again.",
      });
    }
  );

  it("does not send an operation queued by the previous account using the next bearer", async () => {
    const { client } = await mountedTransport();
    const outcome = client.estimate.getById
      .query({ id: "A-draft" })
      .catch((error: Error) => error.message);
    emit("SIGNED_IN", session("B1"));
    expect(await outcome).toBe("Session changed. Please try again.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("accepts an in-flight response after refresh of the same user's token", async () => {
    const { client } = await mountedTransport();
    const response = deferred<Response>();
    vi.mocked(fetch).mockReturnValue(response.promise);
    const outcome = client.estimate.getById.query({ id: "A-draft" });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    emit("TOKEN_REFRESHED", session("A1", "refreshed-A1"));
    response.resolve(rpcResponse({ title: "A current" }));
    expect(await outcome).toEqual({ title: "A current" });
  });
});
