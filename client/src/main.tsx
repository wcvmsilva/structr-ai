import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from "@shared/const";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl, IS_SUPABASE_AUTH, SUPABASE_LOGIN_PATH } from "./const";
import {
  getAuthSessionSnapshot,
  subscribeAuthSession,
  initSupabaseAuthBridge,
} from "./lib/auth-token";
import {
  authSessionLink,
  bindAuthSessionCache,
  buildSessionAuthHeaders,
} from "./lib/auth-session-cache";
import "./index.css";

const queryClient = new QueryClient();
const unbindSessionCache = IS_SUPABASE_AUTH
  ? bindAuthSessionCache(queryClient)
  : () => {};

function AuthSessionBoundary({ children }: { children: ReactNode }) {
  const { generation } = useSyncExternalStore(
    subscribeAuthSession,
    getAuthSessionSnapshot,
    getAuthSessionSnapshot
  );
  // End every page's local state/intent when its operator changes.
  return <Fragment key={generation}>{children}</Fragment>;
}

// DEV-only flag: when enabled, skips OAuth redirects to allow full local access.
// Only applies to the legacy provider — the Supabase flow is exercised in dev too.
const DEV_DISABLE_OAUTH = import.meta.env.DEV && !IS_SUPABASE_AUTH;

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  // Skip redirect in dev mode to allow local testing (legacy provider only)
  if (DEV_DISABLE_OAUTH) return;

  // Entry routes own their authentication state. A delayed business response
  // must not discard a reset callback or interrupt a request for a recovery link.
  if (
    IS_SUPABASE_AUTH &&
    [SUPABASE_LOGIN_PATH, "/forgot-password", "/reset-password"].includes(
      window.location.pathname.toLowerCase().replace(/\/$/, "")
    )
  ) {
    return;
  }

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    ...(IS_SUPABASE_AUTH ? [authSessionLink] : []),
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      /**
       * SUPABASE AUTH V1: attach the Supabase access token to every tRPC call.
       * `buildAuthHeaders()` returns {} when no session exists (or when the build
       * runs on the legacy provider), so the cookie flow below stays intact.
       */
      async headers({ opList }) {
        return IS_SUPABASE_AUTH ? buildSessionAuthHeaders(opList) : {};
      },
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          // Kept for the legacy cookie provider and for the transitional
          // SUPABASE_AUTH_ALLOW_LEGACY_FALLBACK window.
          credentials: "include",
        });
      },
    }),
  ],
});

// Hooks and transport share this same subscription. Session hydration is async;
// auth.me stays disabled until it completes.
const bridgeReady = IS_SUPABASE_AUTH
  ? initSupabaseAuthBridge()
  : Promise.resolve(() => {});
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    unbindSessionCache();
    void bridgeReady.then(stop => stop());
  });

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      {IS_SUPABASE_AUTH ? (
        <AuthSessionBoundary>
          <App />
        </AuthSessionBoundary>
      ) : (
        <App />
      )}
    </QueryClientProvider>
  </trpc.Provider>
);
