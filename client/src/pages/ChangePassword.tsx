import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/_core/hooks/useAuth";
import { IS_SUPABASE_AUTH } from "@/const";
import { requestOwnPasswordRecovery } from "@/lib/password-recovery-session";

export default function ChangePassword() {
  const [, setLocation] = useLocation();
  const { loading, isAuthenticated } = useAuth();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null
  );
  const inFlight = useRef(false);

  useEffect(() => {
    if (!loading && (!IS_SUPABASE_AUTH || !isAuthenticated))
      setLocation("/login");
  }, [loading, isAuthenticated, setLocation]);

  async function handleRequest() {
    if (!IS_SUPABASE_AUTH || !isAuthenticated || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setResult(null);
    try {
      // The adapter resolves the confirmed Auth email for this account. A nullable
      // Structr profile email is neither the destination nor an identity source.
      setResult(await requestOwnPasswordRecovery());
    } catch {
      setResult({
        ok: false,
        message: "Unable to request a reset link. Try again shortly.",
      });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <section className="w-full max-w-md space-y-6 rounded-lg border border-border p-8">
        <h1 className="text-xl font-semibold">Change password</h1>
        {loading ? (
          <p role="status" className="text-sm">
            Checking your account access…
          </p>
        ) : IS_SUPABASE_AUTH && isAuthenticated ? (
          <>
            <p className="text-sm text-muted-foreground">
              We will send a reset link to your account’s confirmed email. Open
              it in this browser to choose a new password.
            </p>
            {result && (
              <p role={result.ok ? "status" : "alert"} className="text-sm">
                {result.message}
              </p>
            )}
            <Button
              type="button"
              className="w-full"
              onClick={handleRequest}
              disabled={pending}
            >
              {pending ? "Requesting link…" : "Send reset link"}
            </Button>
            <Link href="/" className="block text-sm text-gold underline">
              Back to dashboard
            </Link>
          </>
        ) : (
          <p className="text-sm">Sign in to change your password.</p>
        )}
      </section>
    </main>
  );
}
