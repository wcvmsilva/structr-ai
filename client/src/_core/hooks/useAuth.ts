/**
 * structr.ai — Composed auth hook (Supabase Auth V1)
 *
 * Single hook consumed by pages and by DashboardLayout. It composes:
 *
 *   Supabase provider (default)
 *     browser session  → useSupabaseAuth()  (email/password, persistence, auto-refresh)
 *     authorization    → trpc.auth.me       (profile + tenant + RBAC permissions)
 *
 *   Legacy provider (VITE_AUTH_PROVIDER=legacy)
 *     unchanged Phase 1 behaviour, preserved in useLegacyAuth.ts.
 *
 * The returned shape is identical in both modes, so no consumer needs to know which
 * provider is active. Authorization never moves to the client: the profile, tenant and
 * permission set always come from the server, which verifies the bearer token itself.
 */

import { getLoginUrl, IS_SUPABASE_AUTH } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";
import { useSupabaseAuth } from "./useSupabaseAuth";
import {
  getAuthSessionSnapshot,
  refreshSupabaseSession,
} from "@/lib/auth-token";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export type SignInOutcome = { ok: true } | { ok: false; message: string };

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};

  // Hooks cannot be called conditionally: useSupabaseAuth is always mounted and
  // short-circuits to an inert state when Supabase is not configured.
  const supabaseAuth = useSupabaseAuth();
  const supabaseActive = IS_SUPABASE_AUTH && supabaseAuth.configured;

  const utils = trpc.useUtils();

  // Under Supabase, `auth.me` only makes sense once a bearer token exists.
  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    enabled: supabaseActive ? supabaseAuth.isAuthenticated : true,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInOutcome> => {
      if (!supabaseActive) {
        return {
          ok: false,
          message:
            "Email/password sign-in requires AUTH_PROVIDER=supabase and a configured Supabase project.",
        };
      }
      const result = await supabaseAuth.signInWithPassword(email, password);
      if (result.ok) {
        // Pull profile + tenant + RBAC for the freshly minted token.
        await utils.auth.me.invalidate();
      }
      return result;
    },
    [supabaseActive, supabaseAuth, utils]
  );

  const logout = useCallback(async () => {
    if (supabaseActive) {
      // Clear local identity first, then dispatch cookie cleanup in that generation.
      // The shared logout waits for both requests before allowing another login.
      // Use the raw client: a late mutation callback must not clear a newer profile.
      await supabaseAuth.signOut(() => utils.client.auth.logout.mutate());
      return;
    }
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      const alreadySignedOut =
        error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED";
      if (!alreadySignedOut) {
        throw error;
      }
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, supabaseActive, supabaseAuth, utils]);

  const refresh = useCallback(async (): Promise<SignInOutcome> => {
    const expected = getAuthSessionSnapshot();
    const current = () =>
      !supabaseActive ||
      (getAuthSessionSnapshot().generation === expected.generation &&
        getAuthSessionSnapshot().session?.user.id ===
          expected.session?.user.id);
    if (supabaseActive) {
      // End a read sent with the refused token before sharing the new attempt.
      // Concurrent explicit retries then share the post-renewal profile request.
      await utils.auth.me.cancel();
      if (!current())
        return { ok: false, message: "Session changed. Please sign in again." };
      const renewed = await refreshSupabaseSession();
      if (!renewed.ok) return renewed;
    }
    if (!current())
      return { ok: false, message: "Session changed. Please sign in again." };
    const result = await meQuery.refetch({ cancelRefetch: false });
    if (!current())
      return { ok: false, message: "Session changed. Please sign in again." };
    if (
      result.isError ||
      !result.data ||
      (supabaseActive &&
        result.data.externalOpenId !== expected.session?.user.id)
    )
      return {
        ok: false,
        message: supabaseActive
          ? "Your session was refreshed, but account access is still unavailable. Try again or contact your administrator."
          : "Account access is unavailable. Try again or sign in again.",
      };
    return { ok: true };
  }, [supabaseActive, meQuery, utils]);

  const state = useMemo(() => {
    const sessionLoading = supabaseActive ? supabaseAuth.loading : false;
    // Disabled queries can retain data. Never display that profile after logout
    // or for a different subject; only the server grants actual authorization.
    const user = supabaseActive
      ? supabaseAuth.isAuthenticated &&
        !meQuery.isError &&
        meQuery.data?.externalOpenId === supabaseAuth.supabaseUser?.id
        ? (meQuery.data ?? null)
        : null
      : (meQuery.data ?? null);
    // An idle `auth.me` (no Supabase session yet) must not read as "loading",
    // otherwise the shell would hang on the skeleton instead of showing /login.
    const profileLoading = supabaseActive
      ? supabaseAuth.isAuthenticated &&
        (meQuery.isLoading || (!user && meQuery.isFetching))
      : meQuery.isLoading;

    if (typeof window !== "undefined") {
      localStorage.setItem("manus-runtime-user-info", JSON.stringify(user));
    }

    return {
      user,
      loading: sessionLoading || profileLoading || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(user),
      /** Browser session exists (profile may still be resolving). */
      hasSession: supabaseActive ? supabaseAuth.isAuthenticated : Boolean(user),
      /** Provider-level error (bad credentials, unreachable GoTrue, ...). */
      authError: supabaseAuth.error,
      provider: supabaseActive ? ("supabase" as const) : ("legacy" as const),
      supabaseUser: supabaseAuth.supabaseUser,
    };
  }, [
    supabaseActive,
    supabaseAuth.loading,
    supabaseAuth.isAuthenticated,
    supabaseAuth.error,
    supabaseAuth.supabaseUser,
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    meQuery.isFetching,
    meQuery.isError,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (state.loading) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath;
  }, [redirectOnUnauthenticated, redirectPath, state.loading, state.user]);

  return {
    ...state,
    refresh,
    signIn,
    logout,
  };
}
