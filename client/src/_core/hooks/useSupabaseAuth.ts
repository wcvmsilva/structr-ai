/**
 * structr.ai — Supabase auth hook (Supabase Auth V1)
 *
 * Owns the browser-side session: sign in with email/password, expose the current
 * Supabase user, and sign out. It does NOT own authorization — the Structr profile,
 * tenant and RBAC permissions still come from `auth.me` on the server, which resolves
 * them from the verified bearer token.
 *
 * The composed hook `useAuth` (see useAuth.ts) is what pages consume; this module is
 * the Supabase half of it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  getSupabaseClient,
  isSupabaseConfigured,
  requireSupabaseClient,
} from "@/lib/supabase";
import { clearAccessToken, setAccessToken } from "@/lib/auth-token";

export type SupabaseAuthState = {
  session: Session | null;
  /** Still resolving the persisted session on first paint. */
  loading: boolean;
  error: string | null;
};

export type SignInResult =
  | { ok: true }
  | { ok: false; message: string };

/** Translate GoTrue errors into operator-readable copy. */
export function describeAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) {
    return "Invalid email or password.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Email not confirmed. Check your inbox for the confirmation link.";
  }
  if (normalized.includes("too many requests") || normalized.includes("rate limit")) {
    return "Too many attempts. Wait a moment and try again.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("network")) {
    return "Cannot reach the authentication service. Check your connection.";
  }
  return message;
}

export function useSupabaseAuth() {
  const configured = isSupabaseConfigured();
  const [state, setState] = useState<SupabaseAuthState>({
    session: null,
    loading: configured,
    error: null,
  });

  // Hydrate from the persisted session, then follow every auth transition.
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setState({ session: null, loading: false, error: null });
      return;
    }

    let active = true;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        setAccessToken(
          data.session?.access_token ?? null,
          data.session?.expires_at ?? null,
        );
        setState({
          session: data.session ?? null,
          loading: false,
          error: error ? describeAuthError(error.message) : null,
        });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          session: null,
          loading: false,
          error: describeAuthError(String(error)),
        });
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token ?? null, session?.expires_at ?? null);
      setState({ session: session ?? null, loading: false, error: null });
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      try {
        const supabase = requireSupabaseClient();
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          const message = describeAuthError(error.message);
          setState(prev => ({ ...prev, error: message }));
          return { ok: false, message };
        }

        setAccessToken(
          data.session?.access_token ?? null,
          data.session?.expires_at ?? null,
        );
        setState({ session: data.session ?? null, loading: false, error: null });
        return { ok: true };
      } catch (error: unknown) {
        const message = describeAuthError(
          error instanceof Error ? error.message : String(error),
        );
        setState(prev => ({ ...prev, error: message }));
        return { ok: false, message };
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient();
    clearAccessToken();
    if (!supabase) return;
    try {
      await supabase.auth.signOut();
    } catch (error: unknown) {
      // A failed revocation must not trap the operator in a signed-in shell:
      // the local session is already gone.
      console.warn("[SupabaseAuth] signOut failed:", String(error));
    } finally {
      setState({ session: null, loading: false, error: null });
    }
  }, []);

  return useMemo(
    () => ({
      configured,
      session: state.session,
      supabaseUser: state.session?.user ?? null,
      isAuthenticated: Boolean(state.session),
      loading: state.loading,
      error: state.error,
      signInWithPassword,
      signOut,
    }),
    [configured, state, signInWithPassword, signOut],
  );
}
