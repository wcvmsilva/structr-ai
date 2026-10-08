/** Real hook/main/tRPC HTTP adapter, auth.logout and legacy JWT dispatcher.
 * Browser cookie storage, external Auth and the profile DB boundary are controlled;
 * this is not a hosted/browser acceptance proof. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type { QueryClient } from "@tanstack/react-query";
import type { Request as ExpressRequest, CookieOptions } from "express";

const harness = vi.hoisted(() => ({ client: null as any, tree: null as any }));
vi.mock("../client/src/lib/supabase", () => ({
  getSupabaseClient: () => harness.client,
  requireSupabaseClient: () => harness.client,
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
vi.mock("./identity-db", () => ({
  getProfileByExternalOpenId: async (id: string) => ({
    id: "legacy-profile",
    externalOpenId: id,
    tenantId: "tenant-A",
    isActive: true,
  }),
  upsertProfileFromOAuth: () => {
    throw new Error("No provisioning in this test");
  },
}));
vi.mock("./rbac", () => ({ getUserPermissions: async () => new Set() }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => {
    resolve = done;
  });
  return { promise, resolve };
}
function session(id: string): Session {
  return {
    access_token: `token-${id}`,
    refresh_token: `refresh-${id}`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Date.now() / 1000 + 3600,
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
let gate: ReturnType<typeof deferred> | null;
let rejectNetwork: boolean;
let cookie: string;
let completed: Array<{ status: number; setCookie: string | null }>;
let requests: Array<{
  authorization: string | null;
  cookie: string;
  credentials: RequestCredentials | undefined;
  signal: AbortSignal | null | undefined;
}>;
let notify: (event: string, value: Session | null) => void;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_AUTH_PROVIDER", "supabase");
  vi.stubEnv("AUTH_PROVIDER", "supabase");
  vi.stubEnv("STRUCTR_DATABASE_MODE", "direct");
  vi.stubEnv("SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK", "true");
  vi.stubEnv(
    "JWT_SECRET",
    "synthetic-cookie-signing-secret-only-for-this-test"
  );
  vi.stubEnv("VITE_APP_ID", "synthetic-app");
  gate = null;
  rejectNetwork = false;
  completed = [];
  requests = [];
  cookie = "";
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
      getSession: async () => ({
        data: { session: session("A1") },
        error: null,
      }),
      onAuthStateChange: (fn: typeof notify) => {
        notify = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: vi.fn(async () => ({ error: null })),
      signInWithPassword: vi.fn(async () => ({
        data: { session: session("B1"), user: session("B1").user },
        error: null,
      })),
    },
  };
});
afterEach(() => {
  gate?.resolve();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderAuth() {
  const { fetchRequestHandler } = await import("@trpc/server/adapters/fetch");
  const { router } = await import("./_core/trpc");
  const { authRouter } = await import("./auth-router");
  const server = router({ auth: authRouter });
  const express = (await import("express")).default;
  const { serialize } = await import("cookie");
  const { sdk } = await import("./_core/sdk");
  const { COOKIE_NAME } = await import("../shared/const");
  cookie = `${COOKIE_NAME}=${await sdk.createSessionToken("legacy-A1", { name: "Synthetic A1" })}`;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input), "https://app.example.test");
      // The actual main.tsx/httpBatchLink must deliver the one cookie-cleanup RPC.
      expect(url.pathname).toBe("/api/trpc/auth.logout");
      const headers = new Headers(init?.headers);
      const sentCookie = init?.credentials === "include" ? cookie : "";
      if (sentCookie) headers.set("cookie", sentCookie);
      requests.push({
        authorization: headers.get("authorization"),
        cookie: sentCookie,
        credentials: init?.credentials,
        signal: init?.signal,
      });
      if (rejectNetwork) throw new TypeError("Synthetic network failure");
      const response = await fetchRequestHandler({
        endpoint: "/api/trpc",
        router: server,
        req: new Request(url, { ...init, headers }),
        createContext: ({ resHeaders }) => ({
          user: null,
          tenantId: null,
          authProvider: "supabase" as const,
          req: {
            protocol: "https",
            hostname: url.hostname,
            headers: Object.fromEntries(headers),
          } as ExpressRequest,
          res: {
            clearCookie: (name: string, options: CookieOptions) =>
              express.response.clearCookie.call(
                {
                  cookie: (key: string, value: string, opts: CookieOptions) => {
                    resHeaders.append(
                      "set-cookie",
                      serialize(key, value, opts as any)
                    );
                  },
                } as any,
                name,
                options
              ),
          } as any,
        }),
      });
      await gate?.promise;
      if (init?.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      const setCookie = response.headers.get("set-cookie");
      if (setCookie?.startsWith(`${COOKIE_NAME}=;`)) cookie = "";
      completed.push({ status: response.status, setCookie });
      return response;
    })
  );
  await import("../client/src/main");
  const token = await import("../client/src/lib/auth-token");
  await token.initSupabaseAuthBridge();
  const { client, queryClient } = harness.tree.props as {
    client: any;
    queryClient: QueryClient;
  };
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { QueryClientProvider } = await import("@tanstack/react-query");
  const { getQueryKey } = await import("@trpc/react-query");
  const { trpc } = await import("../client/src/lib/trpc");
  const { useAuth } = await import("../client/src/_core/hooks/useAuth");
  const meKey = getQueryKey(trpc.auth.me, undefined, "query");
  queryClient.setQueryData(meKey, profile);
  queryClient.setQueryData(["private-project"], { owner: "A1" });
  let auth!: ReturnType<typeof useAuth>;
  function Probe() {
    auth = useAuth();
    return null;
  }
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
  const { authenticateRequest } = await import("./_core/auth");
  const fallback = () =>
    authenticateRequest({ headers: { cookie } } as ExpressRequest, "supabase");
  return { auth, token, queryClient, meKey, fallback };
}

describe("homolog UI: Supabase logout closes the legacy-cookie fallback", () => {
  it("completes the real cookie-clear response after immediate identity/cache removal and stops signed-cookie fallback", async () => {
    const actual = await renderAuth();
    await expect(actual.fallback()).resolves.toMatchObject({
      externalOpenId: "legacy-A1",
    });
    const logout = actual.auth.logout();
    expect(actual.token.getAccessToken()).toBeNull();
    expect(
      actual.queryClient.getQueryData(["private-project"])
    ).toBeUndefined();
    await logout;
    expect(completed).toEqual([
      { status: 200, setCookie: expect.stringContaining("app_session_id=;") },
    ]);
    expect(requests).toEqual([
      expect.objectContaining({
        authorization: null,
        credentials: "include",
        cookie: expect.stringContaining("app_session_id="),
      }),
    ]);
    await expect(actual.fallback()).rejects.toThrow("Invalid session cookie");
  });

  it("keeps the shared next login waiting for cookie cleanup even after provider revocation settles", async () => {
    const actual = await renderAuth();
    gate = deferred();
    const logout = actual.auth.logout();
    const nextLogin = actual.token.signInSupabaseSession(
      "B1@example.test",
      "synthetic-password"
    );
    // Observe dispatch rather than assume a particular batch-timer duration.
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(harness.client.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(requests[0].signal?.aborted).toBe(false);
    expect(completed).toHaveLength(0);
    notify("SIGNED_OUT", null);
    expect(actual.token.getAccessToken()).toBeNull();
    gate.resolve();
    await logout;
    await expect(nextLogin).resolves.toEqual({ ok: true });
    const nextProfile = { ...profile, externalOpenId: "B1" };
    actual.queryClient.setQueryData(actual.meKey, nextProfile);
    await Promise.resolve();
    expect(actual.queryClient.getQueryData(actual.meKey)).toEqual(nextProfile);
    expect(actual.token.getAccessToken()).toBe("token-B1");
    expect(completed).toHaveLength(1);
  });

  it("tolerates the actual Data API guard's rejection without restoring the bearer or opening the mutation", async () => {
    const actual = await renderAuth();
    vi.stubEnv("STRUCTR_DATABASE_MODE", "authenticated-data-api");
    await expect(actual.auth.logout()).resolves.toBeUndefined();
    expect(completed).toEqual([{ status: 403, setCookie: null }]);
    expect(actual.token.getAccessToken()).toBeNull();
    expect(actual.queryClient.getQueryData(actual.meKey)).toBeUndefined();
    expect(harness.client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it("keeps logout local and permits an explicit new login after best-effort cookie transport fails", async () => {
    const actual = await renderAuth();
    rejectNetwork = true;
    await expect(actual.auth.logout()).resolves.toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(completed).toHaveLength(0);
    expect(actual.token.getAccessToken()).toBeNull();
    await expect(
      actual.token.signInSupabaseSession(
        "B1@example.test",
        "synthetic-password"
      )
    ).resolves.toEqual({ ok: true });
    expect(actual.token.getAccessToken()).toBe("token-B1");
    // No claim of server-cookie removal can be made when HTTP failed.
    await expect(actual.fallback()).resolves.toMatchObject({
      externalOpenId: "legacy-A1",
    });
  });
});
