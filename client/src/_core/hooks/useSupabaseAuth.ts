/** Shared browser session; Structr authorization is still resolved by auth.me. */
import { useSyncExternalStore } from "react";
import { IS_SUPABASE_AUTH } from "@/const";
import { isSupabaseConfigured } from "@/lib/supabase";
import {
  getAuthSessionSnapshot,
  subscribeAuthSession,
  signInSupabaseSession,
  signOutSupabaseSession,
} from "@/lib/auth-token";

export { describeAuthError } from "@/lib/auth-token";
export type SignInResult = { ok: true } | { ok: false; message: string };

export function useSupabaseAuth() {
  const state = useSyncExternalStore(
    subscribeAuthSession,
    getAuthSessionSnapshot,
    getAuthSessionSnapshot
  );
  return {
    configured: IS_SUPABASE_AUTH && isSupabaseConfigured(),
    session: state.session,
    supabaseUser: state.session?.user ?? null,
    isAuthenticated: Boolean(state.session),
    loading: state.loading,
    error: state.error,
    generation: state.generation,
    signInWithPassword: signInSupabaseSession,
    signOut: signOutSupabaseSession,
  };
}
