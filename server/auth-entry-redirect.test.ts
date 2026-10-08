/** Real main.tsx cache subscriptions, with only root rendering and Auth isolated. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";

const harness = vi.hoisted(() => ({ tree: null as any }));
vi.mock("../client/src/App", () => ({ default: () => null }));
vi.mock("react-dom/client", () => ({
  createRoot: () => ({
    render: (tree: unknown) => {
      harness.tree = tree;
    },
  }),
}));
vi.mock("../client/src/lib/auth-token", () => ({
  getAuthSessionSnapshot: () => ({
    session: null,
    loading: false,
    error: null,
    generation: 0,
  }),
  subscribeAuthSession: () => () => {},
  initSupabaseAuthBridge: async () => () => {},
}));
vi.mock("../client/src/lib/auth-session-cache", () => ({
  bindAuthSessionCache: () => () => {},
  authSessionLink:
    () =>
    ({ op, next }: any) =>
      next(op),
  buildSessionAuthHeaders: async () => ({}),
}));
let location: { pathname: string; href: string };
let queryClient: QueryClient | undefined;
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_AUTH_PROVIDER", "supabase");
  location = {
    pathname: "/estimates/draft",
    href: "https://app.example.test/estimates/draft",
  };
  vi.stubGlobal("window", { location });
  vi.stubGlobal("document", { getElementById: () => ({}) });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  queryClient?.clear();
  queryClient = undefined;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function load() {
  await import("../client/src/main");
  queryClient = harness.tree.props.queryClient as QueryClient;
  const { TRPCClientError } = await import("@trpc/client");
  const { UNAUTHED_ERR_MSG } = await import("../shared/const");
  return { queryClient, denied: new TRPCClientError(UNAUTHED_ERR_MSG) };
}
function delayedFailure() {
  let reject!: (error: unknown) => void;
  const promise = new Promise<never>((_resolve, fail) => {
    reject = fail;
  });
  return { promise, reject };
}
async function request(
  kind: "query" | "mutation",
  client: QueryClient,
  promise: Promise<never>
) {
  if (kind === "query")
    return client.fetchQuery({
      queryKey: ["old-business-query"],
      queryFn: () => promise,
      retry: false,
    });
  return client
    .getMutationCache()
    .build(client, { mutationFn: () => promise, retry: false })
    .execute(undefined);
}

describe("auth entry routes survive delayed unauthorized responses", () => {
  it.each([
    ["query", "/reset-password"],
    ["mutation", "/reset-password"],
    ["query", "/reset-password/"],
    ["mutation", "/RESET-PASSWORD"],
    ["query", "/forgot-password"],
    ["mutation", "/forgot-password"],
    ["query", "/forgot-password/"],
    ["mutation", "/FORGOT-PASSWORD"],
    ["query", "/login"],
    ["mutation", "/login"],
  ] as const)(
    "keeps %s failure on %s instead of discarding its recovery callback",
    async (kind, path) => {
      const { queryClient, denied } = await load();
      const old = delayedFailure();
      const pending = request(kind, queryClient, old.promise).catch(
        error => error
      );
      await Promise.resolve();
      location.pathname = path;
      location.href = `https://app.example.test${path}?code=synthetic-callback`;
      old.reject(denied);
      expect(await pending).toBe(denied);
      expect(location.href).toBe(
        `https://app.example.test${path}?code=synthetic-callback`
      );
      expect(console.error).toHaveBeenCalled();
    }
  );

  it.each(["query", "mutation"] as const)(
    "still redirects an unauthorized business %s to login",
    async kind => {
      const { queryClient, denied } = await load();
      const old = delayedFailure();
      const pending = request(kind, queryClient, old.promise).catch(
        error => error
      );
      old.reject(denied);
      expect(await pending).toBe(denied);
      expect(location.href).toBe("/login");
    }
  );

  it.each(["query", "mutation"] as const)(
    "does not redirect an unrelated %s failure",
    async kind => {
      const { queryClient } = await load();
      const { TRPCClientError } = await import("@trpc/client");
      const failure = new TRPCClientError(
        "Account service temporarily unavailable"
      );
      const old = delayedFailure();
      const pending = request(kind, queryClient, old.promise).catch(
        error => error
      );
      old.reject(failure);
      expect(await pending).toBe(failure);
      expect(location.href).toBe("https://app.example.test/estimates/draft");
    }
  );
});
