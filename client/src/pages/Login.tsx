/**
 * structr.ai — Sign in (Supabase Auth V1)
 *
 * Email/password form backed by Supabase GoTrue. On success, supabase-js persists the
 * session, the tRPC link starts attaching `Authorization: Bearer <token>`, and the
 * operator is returned to the page they were trying to reach (or the dashboard).
 *
 * Under AUTH_PROVIDER=legacy this route redirects to the Manus OAuth portal instead,
 * so a rollback needs no routing change.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "wouter";
import { Loader2, Lock, Mail, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/_core/hooks/useAuth";
import { isSupabaseConfigured } from "@/lib/supabase";
import { getLoginUrl, IS_SUPABASE_AUTH } from "@/const";

/** Where to land after a successful sign-in. */
const DEFAULT_REDIRECT = "/";

function readRedirectTarget(): string {
  if (typeof window === "undefined") return DEFAULT_REDIRECT;
  const params = new URLSearchParams(window.location.search);
  const target = params.get("redirect");
  // Only allow same-origin relative paths — never an absolute URL.
  if (target && target.startsWith("/") && !target.startsWith("//")) {
    return target;
  }
  return DEFAULT_REDIRECT;
}

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { signIn, hasSession, loading, authError } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const configured = isSupabaseConfigured();

  // Legacy rollback: this route is not a form, it is a bounce to the OAuth portal.
  useEffect(() => {
    if (IS_SUPABASE_AUTH) return;
    if (typeof window === "undefined") return;
    window.location.href = getLoginUrl();
  }, []);

  // Already signed in → leave the login screen.
  useEffect(() => {
    if (!hasSession) return;
    setLocation(readRedirectTarget());
  }, [hasSession, setLocation]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    if (!email.trim() || !password) {
      setFormError("Enter your email and password.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await signIn(email, password);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      setLocation(readRedirectTarget());
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || loading;
  const message = formError ?? authError;

  return (
    <div className="flex items-center justify-center min-h-screen bg-background px-4">
      <div className="flex flex-col items-center gap-8 p-8 max-w-md w-full">
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-2">
            <Shield className="h-10 w-10 text-gold" />
            <span className="text-2xl font-extrabold tracking-tight">
              <span className="bg-gradient-to-r from-gold-dark via-gold to-gold-light bg-clip-text text-transparent">
                structr.ai
              </span>
            </span>
          </div>
          <div className="h-[2px] w-48 bg-gradient-to-r from-transparent via-gold to-transparent" />
        </div>

        <div className="flex flex-col items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-center text-foreground">
            Sign in to continue
          </h1>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            Use your structr.ai operator credentials.
          </p>
        </div>

        {!configured && IS_SUPABASE_AUTH ? (
          <div
            role="alert"
            className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            Supabase is not configured in this build. Set
            <code className="mx-1">VITE_SUPABASE_URL</code> and
            <code className="mx-1">VITE_SUPABASE_PUBLISHABLE_KEY</code>, then rebuild.
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="operator@gchi.com"
                className="pl-9"
                value={email}
                onChange={event => setEmail(event.target.value)}
                disabled={busy || !configured}
                required
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                className="pl-9"
                value={password}
                onChange={event => setPassword(event.target.value)}
                disabled={busy || !configured}
                required
              />
            </div>
          </div>

          {message ? (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          ) : null}

          <Button
            type="submit"
            size="lg"
            disabled={busy || !configured}
            className="w-full bg-gradient-to-r from-gold-dark via-gold to-gold-light text-background font-bold shadow-lg hover:shadow-[0_6px_25px_var(--color-gold-glow-strong)] transition-all"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        <p className="text-xs text-muted-foreground text-center">
          Access is restricted to authorized GCHI operators. Contact your administrator
          to have an account provisioned.
        </p>
      </div>
    </div>
  );
}
