/** Real hooks rendered through React SSR and real tRPC/QueryClient providers.
 * Provider Auth is controlled; this does not substitute for browser acceptance. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

const boundary = vi.hoisted(() => ({ client: null as any }));
vi.mock("../client/src/lib/supabase", () => ({
  getSupabaseClient: () => boundary.client,
  requireSupabaseClient: () => boundary.client,
  isSupabaseConfigured: () => true,
  SUPABASE_STORAGE_KEY: "structr-supabase-auth",
}));
let session: Session | null;
let notify: (event: string, value: Session | null) => void;
const profile = {
  id: "profile-A1",
  externalOpenId: "A1",
  tenantId: "tenant-A",
  fullName: "Operator A1",
  permissions: [],
};
beforeEach(() => {
  vi.resetModules();
  session = {
    access_token: "A-token",
    refresh_token: "A-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Date.now() / 1000 + 3600,
    user: {
      id: "A1",
      aud: "authenticated",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-10-08T00:00:00Z",
    },
  };
  boundary.client = {
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      onAuthStateChange: (fn: typeof notify) => {
        notify = fn;
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: vi.fn(async () => ({ error: null })),
    },
  };
  vi.stubGlobal("localStorage", { setItem() {}, removeItem() {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderAuth(cached: unknown, pendingLogout = false) {
  const token = await import("../client/src/lib/auth-token");
  await token.initSupabaseAuthBridge();
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { QueryClient, QueryClientProvider } = await import(
    "@tanstack/react-query"
  );
  const { getQueryKey } = await import("@trpc/react-query");
  const { observable } = await import("@trpc/server/observable");
  const { trpc } = await import("../client/src/lib/trpc");
  const { useAuth } = await import("../client/src/_core/hooks/useAuth");
  const queryClient = new QueryClient();
  if (cached !== undefined)
    queryClient.setQueryData(
      getQueryKey(trpc.auth.me, undefined, "query"),
      cached
    );
  let completeLogout: () => void = () => {};
  const client = trpc.createClient({
    links: [
      () =>
        ({ op }) =>
          observable(observer => {
            completeLogout = () => {
              observer.next({ result: { data: { success: true } } });
              observer.complete();
            };
            if (!(pendingLogout && op.path === "auth.logout")) completeLogout();
          }),
    ],
  });
  let actual!: ReturnType<typeof useAuth>;
  function Probe() {
    actual = useAuth();
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
  return {
    auth: actual,
    token,
    render,
    read: () => actual,
    completeLogout: () => completeLogout(),
  };
}

describe("homolog UI: composed profile/session state", () => {
  it("never exposes a cached profile through a disabled query after sign-out", async () => {
    session = null;
    const { auth } = await renderAuth(profile);
    expect(auth.hasSession).toBe(false);
    expect(auth.user).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
  });

  it("does not expose a profile belonging to the previous Auth subject", async () => {
    session = { ...session!, user: { ...session!.user, id: "B1" } };
    const { auth } = await renderAuth(profile);
    expect(auth.hasSession).toBe(true);
    expect(auth.user).toBeNull();
    expect(auth.isAuthenticated).toBe(false);
  });

  it("keeps a session without a resolved profile pending, not authorized", async () => {
    const { auth } = await renderAuth(undefined);
    expect(auth.hasSession).toBe(true);
    expect(auth.loading).toBe(true);
    expect(auth.isAuthenticated).toBe(false);
  });

  it("exposes the current server profile after resolution", async () => {
    const { auth } = await renderAuth(profile);
    expect(auth.loading).toBe(false);
    expect(auth.user).toEqual(profile);
    expect(auth.isAuthenticated).toBe(true);
  });

  it("removes the local bearer before waiting for the logout network request", async () => {
    const rendered = await renderAuth(profile, true);
    const logout = rendered.auth.logout();
    expect(rendered.token.getAccessToken()).toBeNull();
    await Promise.resolve();
    rendered.completeLogout();
    await logout;
    expect(await rendered.token.buildAuthHeaders()).toEqual({});
  });

  it("a provider sign-out event suppresses the old cached profile on the next render", async () => {
    const rendered = await renderAuth(profile);
    notify("SIGNED_OUT", null);
    rendered.render();
    expect(rendered.read().user).toBeNull();
    expect(rendered.read().hasSession).toBe(false);
  });
});
