import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl, IS_SUPABASE_AUTH, SUPABASE_LOGIN_PATH } from "./const";
import { buildAuthHeaders, initSupabaseAuthBridge } from "./lib/auth-token";
import "./index.css";

const queryClient = new QueryClient();

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

  // SUPABASE AUTH V1: never bounce a user who is already on the login screen,
  // otherwise a failed `auth.me` would trap the page in a redirect loop.
  if (IS_SUPABASE_AUTH && window.location.pathname === SUPABASE_LOGIN_PATH) {
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
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      /**
       * SUPABASE AUTH V1: attach the Supabase access token to every tRPC call.
       * `buildAuthHeaders()` returns {} when no session exists (or when the build
       * runs on the legacy provider), so the cookie flow below stays intact.
       */
      async headers() {
        return buildAuthHeaders();
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

// SUPABASE AUTH V1: hydrate the token cache before the first render so the very
// first tRPC batch already carries the Authorization header on a warm reload.
void initSupabaseAuthBridge();

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
